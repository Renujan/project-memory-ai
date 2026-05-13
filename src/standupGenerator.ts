import { SimpleGit, simpleGit } from 'simple-git';
import { AISummarizer } from './aiSummarizer';
import { GitAnalyzer } from './gitAnalyzer';

export interface StandupResult {
    yesterday: string;
    today: string;
    blockers: string;
    generatedAt: string;
}

/**
 * StandupGenerator class to generate daily standups based on recent activity.
 */
export class StandupGenerator {
    private git: SimpleGit;
    private aiSummarizer: AISummarizer;
    private gitAnalyzer: GitAnalyzer;

    /**
     * Creates an instance of StandupGenerator.
     * @param {string} workspaceRoot - The root path of the workspace.
     * @param {GitAnalyzer} gitAnalyzer - Git Analyzer.
     * @param {AISummarizer} aiSummarizer - AI Summarizer.
     */
    constructor(workspaceRoot: string, gitAnalyzer: GitAnalyzer, aiSummarizer: AISummarizer) {
        this.git = simpleGit(workspaceRoot);
        this.gitAnalyzer = gitAnalyzer;
        this.aiSummarizer = aiSummarizer;
    }

    /**
     * Generates a daily standup using the AI.
     * @returns {Promise<StandupResult>} The standup result.
     */
    public async generateStandup(): Promise<StandupResult> {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const last24hLog = await this.git.log({ '--after': oneDayAgo });
        const last24hCommits = last24hLog.all;

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const last7dLog = await this.git.log({ '--after': sevenDaysAgo });
        // Although fetched, we only use recent context to keep prompt small
        const last7dCommits = last7dLog.all;

        const summary = await this.gitAnalyzer.getSummary();

        let commitsText = last24hCommits.map(c => `- ${c.message}`).join('\n').substring(0, 300);
        let contextText = last7dCommits.slice(last24hCommits.length, last24hCommits.length + 10).map(c => `- ${c.message}`).join('\n').substring(0, 200);
        
        if (last24hCommits.length === 0) {
            commitsText = last7dCommits.slice(0, 10).map(c => `- ${c.message}`).join('\n').substring(0, 300);
            contextText = "No additional context.";
        }
        
        const todosText = summary.todos.map(t => `- ${t.text}`).join('\n').substring(0, 200);

        const prompt = `You are a developer writing a daily standup update. Based on these recent git commits and project context, generate a standup in exactly this format:
Yesterday: [what was done based on commits].
Today: [logical next steps based on unfinished work].
Blockers: [any issues found or None detected].
Keep each line under 100 characters. Be specific about file names and features.
Recent Context (Last 7 Days):
${contextText || 'No earlier commits.'}
Yesterday's Commits:
${commitsText || 'No commits in last 24 hours.'}
TODOs:
${todosText || 'No TODOs.'}`;

        const systemMsg = "You are an expert developer.";
        const rawResponse = await this.aiSummarizer.askAI(prompt, systemMsg);

        const yesterdayMatch = rawResponse.match(/Yesterday:\s*(.+)/i);
        const todayMatch = rawResponse.match(/Today:\s*(.+)/i);
        const blockersMatch = rawResponse.match(/Blockers:\s*(.+)/i);

        return {
            yesterday: yesterdayMatch ? yesterdayMatch[1].trim() : 'Worked on the project.',
            today: todayMatch ? todayMatch[1].trim() : 'Continue current tasks.',
            blockers: blockersMatch ? blockersMatch[1].trim() : 'None detected.',
            generatedAt: new Date().toISOString()
        };
    }

    /**
     * Formats the standup result for Slack with emojis.
     * @param {StandupResult} standup - The standup data.
     * @returns {string} Formatted string.
     */
    public formatAsSlack(standup: StandupResult): string {
        return `:white_check_mark: Yesterday: ${standup.yesterday}\n:hammer: Today: ${standup.today}\n:warning: Blockers: ${standup.blockers}`;
    }

    /**
     * Formats the standup result as plain text.
     * @param {StandupResult} standup - The standup data.
     * @returns {string} Formatted string.
     */
    public formatAsPlain(standup: StandupResult): string {
        return `Yesterday: ${standup.yesterday}\nToday: ${standup.today}\nBlockers: ${standup.blockers}`;
    }
}
