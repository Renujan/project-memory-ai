import * as vscode from 'vscode';
import { GitSummary } from './gitAnalyzer';

export interface AISummaryResult {
    paragraph: string;
    suggestions: string[];
}

/**
 * AISummarizer class to interact with Groq API and generate project context summaries.
 */
export class AISummarizer {
    private secretStorage: vscode.SecretStorage;

    /**
     * Creates an instance of AISummarizer.
     * @param {vscode.SecretStorage} secretStorage - The secret storage of the extension.
     */
    constructor(secretStorage: vscode.SecretStorage) {
        this.secretStorage = secretStorage;
    }

    /**
     * Generates an AI summary based on the provided Git metadata.
     * @param {GitSummary} gitData - The git summary data.
     * @returns {Promise<AISummaryResult>} The generated summary and suggestions.
     */
    public async generateSummary(gitData: GitSummary): Promise<AISummaryResult> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        try {
            const apiKey = await this.secretStorage.get('projectMemory.groqApiKey');
            if (!apiKey) {
                throw new Error("Groq API key not found. Please set it using the command.");
            }

            const prompt = this.buildPrompt(gitData);
            
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: 'You are a helpful AI assistant that summarizes what a developer was working on. Respond in clean plain text only, with no markdown asterisks or bullet symbols. Write like a senior developer leaving notes for themselves.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 500
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Groq API error: ${response.status} ${errText}`);
            }

            const data = await response.json() as any;
            const content = data.choices?.[0]?.message?.content || "No summary generated.";

            return this.parseResponse(content);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                return {
                    paragraph: `Summary timed out. Your project has ${gitData.recentCommits.length} commits. Last active: ${gitData.lastCommitDate ? gitData.lastCommitDate.toLocaleDateString() : 'Unknown'}. Click refresh to try again.`,
                    suggestions: []
                };
            }
            console.error("Error generating AI summary", error);
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Sends a custom prompt to the Groq API.
     * @param {string} prompt - The prompt.
     * @param {string} systemMessage - The system role message.
     * @returns {Promise<string>} The response string.
     */
    public async askAI(prompt: string, systemMessage: string = 'You are a helpful AI assistant.'): Promise<string> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        try {
            const apiKey = await this.secretStorage.get('projectMemory.groqApiKey');
            if (!apiKey) {
                throw new Error("Groq API key not found. Please set it using the command.");
            }

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: systemMessage },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 500
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Groq API error: ${response.status} ${errText}`);
            }

            const data = await response.json() as any;
            return data.choices?.[0]?.message?.content || "";
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Builds the prompt to send to the AI based on git data.
     * @param {GitSummary} gitData - The git summary data.
     * @returns {string} The constructed prompt.
     */
    private buildPrompt(gitData: GitSummary): string {
        const commitMessages = gitData.recentCommits.slice(0, 5).map(c => `- ${c.message}`).join('\n').substring(0, 150);
        const files = gitData.filesChangedLastSession.slice(0, 5).join(', ').substring(0, 100);
        const todos = gitData.todos.slice(0, 3).map(t => `- ${t.text}`).join('\n').substring(0, 100);

        return `
I have returned to my project after ${gitData.daysSinceLastCommit} days.
Here are my last 5 commit messages:
${commitMessages || "No recent commits."}

Here are some files I was recently editing:
${files || "No recent files."}

Here are some TODOs I left behind:
${todos || "No TODOs found."}

Based on this, write two things:
1. "PARAGRAPH:": A short, friendly "Welcome back" paragraph explaining what I was working on. Use max 4 sentences. Be specific about the actual files and features mentioned in commits. Do not use generic phrases like "it looks like you were working on".
2. "SUGGESTIONS:": IMPORTANT: For suggestions output ONLY this format:
1. suggestion one
2. suggestion two
3. suggestion three
Do not use asterisks. Do not use bullet points.
Do not add any symbol before the number.
        `;
    }

    /**
     * Parses the AI's plain text response into structured data.
     * @param {string} content - The raw response content.
     * @returns {AISummaryResult} The parsed result.
     */
    private parseResponse(content: string): AISummaryResult {
        const paragraphMatch = content.match(/PARAGRAPH:\s*([\s\S]*?)(?:SUGGESTIONS:|$)/i);
        const suggestionsMatch = content.match(/SUGGESTIONS:\s*([\s\S]*)$/i);

        const paragraph = paragraphMatch ? paragraphMatch[1].trim() : content.trim();
        const suggestionsRaw = suggestionsMatch ? suggestionsMatch[1].trim() : "";
        
        const suggestions = suggestionsRaw
            .split('\n')
            .map(s => s.replace(/^[-*•\d.]\s*/, '').trim())
            .filter(s => s.length > 0);

        return {
            paragraph,
            suggestions
        };
    }
}
