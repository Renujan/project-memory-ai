import { SimpleGit, simpleGit } from 'simple-git';
import * as vscode from 'vscode';
import { AISummarizer } from './aiSummarizer';

export interface ChangedFile {
    file: string;
    diff: string;
}

/**
 * CommitGenerator class to analyze git diffs and generate commit messages.
 */
export class CommitGenerator {
    private git: SimpleGit;
    private aiSummarizer: AISummarizer;

    /**
     * Creates an instance of CommitGenerator.
     * @param {string} workspaceRoot - The root path of the workspace.
     * @param {AISummarizer} aiSummarizer - The AI summarizer instance.
     */
    constructor(workspaceRoot: string, aiSummarizer: AISummarizer) {
        this.git = simpleGit(workspaceRoot);
        this.aiSummarizer = aiSummarizer;
    }

    /**
     * Gets a list of unstaged and staged changes with their diffs.
     * @returns {Promise<ChangedFile[]>} Array of changed files and diffs.
     */
    public async getUnstagedChanges(): Promise<ChangedFile[]> {
        try {
            const status = await this.git.status();
            const allFiles = new Set([...status.not_added, ...status.created, ...status.deleted, ...status.modified, ...status.renamed.map(r => r.to)]);
            
            // Apply file filter
            const filteredFiles = Array.from(allFiles).filter(f => {
                const lower = f.toLowerCase();
                if (lower.endsWith('.json')) return false;
                if (lower.endsWith('.sqlite3')) return false;
                if (lower.endsWith('.pyc')) return false;
                if (lower.includes('__pycache__')) return false;
                if (lower.includes('.vscode/project-memory')) return false;
                
                return true; // Include everything else, or restrict to extensions if wanted. The user said "exclude files matching...". I will just use the exclusions.
            });
            
            const changes: ChangedFile[] = [];
            for (const file of filteredFiles) {
                try {
                    const diff = await this.git.diff(['HEAD', file]);
                    changes.push({
                        file,
                        diff: diff ? diff.substring(0, 200) : "No changes detected or binary file."
                    });
                } catch (e) {
                    changes.push({ file, diff: "New untracked file." });
                }
            }
            return changes;
        } catch (error) {
            console.error("Failed to get changes", error);
            return [];
        }
    }

    /**
     * Generates a commit message using the AI.
     * @param {ChangedFile[]} changes - The changed files and diffs.
     * @returns {Promise<string>} The generated commit message.
     */
    public async generateCommitMessage(changes: ChangedFile[]): Promise<string> {
        if (changes.length === 0) {
            throw new Error("No changes to commit.");
        }

        const filesList = changes.map(c => c.file).join(', ').substring(0, 200);
        const diffsList = changes.map(c => `File: ${c.file}\nDiff:\n${c.diff}`).join('\n---\n').substring(0, 300);

        const prompt = `You are an expert developer. Based on these file changes, generate ONE professional git commit message. Follow conventional commits format: type(scope): description. Types: feat, fix, refactor, style, docs, test, chore. Maximum 72 characters. Return ONLY the commit message, nothing else. No explanation. Changed files: ${filesList}. Diffs: ${diffsList}`;

        const systemMsg = "You are an expert developer.";
        const message = await this.aiSummarizer.askAI(prompt, systemMsg);
        return message.trim();
    }

    /**
     * Copies text to the clipboard.
     * @param {string} text - The text to copy.
     */
    public async copyToClipboard(text: string): Promise<void> {
        await vscode.env.clipboard.writeText(text);
    }
}
