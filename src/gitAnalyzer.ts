import { simpleGit, SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';

export interface GitCommit {
    hash: string;
    date: string;
    message: string;
    author_name: string;
}

export interface GitSummary {
    branch: string;
    daysSinceLastCommit: number;
    lastCommitDate: Date | null;
    recentCommits: GitCommit[];
    filesChangedLastSession: string[];
    todos: TodoItem[];
}

export interface TodoItem {
    file: string;
    line: number;
    text: string;
}

/**
 * GitAnalyzer class to interact with git repository and extract summary data.
 */
export class GitAnalyzer {
    private git: SimpleGit;
    private workspaceRoot: string;

    /**
     * Creates an instance of GitAnalyzer.
     * @param {string} workspaceRoot - The root path of the workspace.
     */
    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.git = simpleGit(this.workspaceRoot);
    }

    /**
     * Generates a complete git summary for the project.
     * @returns {Promise<GitSummary>} A promise resolving to the git summary.
     */
    public async getSummary(): Promise<GitSummary> {
        try {
            const isRepo = await this.git.checkIsRepo();
            if (!isRepo) {
                throw new Error("Not a git repository");
            }

            const branch = await this.getBranchName();
            const recentCommits = await this.getRecentCommits();
            const lastCommitDate = recentCommits.length > 0 ? new Date(recentCommits[0].date) : null;
            const daysSinceLastCommit = lastCommitDate ? this.calculateDaysSince(lastCommitDate) : 0;
            
            const filesChangedLastSession = await this.getFilesChangedLastSession();
            const todos = await this.extractTodos(filesChangedLastSession);

            return {
                branch,
                daysSinceLastCommit,
                lastCommitDate,
                recentCommits,
                filesChangedLastSession,
                todos
            };
        } catch (error) {
            console.error("Error generating git summary:", error);
            throw error;
        }
    }

    /**
     * Gets the current branch name.
     * @returns {Promise<string>} The name of the current branch.
     */
    private async getBranchName(): Promise<string> {
        try {
            const status = await this.git.status();
            return status.current || 'unknown';
        } catch (error) {
            console.error("Failed to get branch name", error);
            return 'unknown';
        }
    }

    /**
     * Retrieves the last 20 commits.
     * @returns {Promise<GitCommit[]>} Array of recent commits.
     */
    private async getRecentCommits(): Promise<GitCommit[]> {
        try {
            const log = await this.git.log({ maxCount: 20 });
            return log.all.map(commit => ({
                hash: commit.hash,
                date: commit.date,
                message: commit.message,
                author_name: commit.author_name
            }));
        } catch (error) {
            console.error("Failed to get recent commits", error);
            return [];
        }
    }

    /**
     * Gets a list of files changed in the most recent commit or currently uncommitted.
     * @returns {Promise<string[]>} List of file paths.
     */
    private async getFilesChangedLastSession(): Promise<string[]> {
        try {
            const status = await this.git.status();
            const uncommittedFiles = status.files.map(f => f.path);
            
            let lastCommitFiles: string[] = [];
            const log = await this.git.log({ maxCount: 1 });
            if (log.latest) {
                const show = await this.git.show(['--name-only', '--format=', log.latest.hash]);
                lastCommitFiles = show.split('\n').map(s => s.trim()).filter(s => s.length > 0);
            }
            
            // Combine and unique
            const allFiles = new Set([...uncommittedFiles, ...lastCommitFiles]);
            return Array.from(allFiles);
        } catch (error) {
            console.error("Failed to get changed files", error);
            return [];
        }
    }

    /**
     * Extracts TODOs and FIXMEs from a list of files.
     * @param {string[]} files - List of file paths to search.
     * @returns {Promise<TodoItem[]>} Array of found TODOs.
     */
    private async extractTodos(files: string[]): Promise<TodoItem[]> {
        const todos: TodoItem[] = [];
        const todoRegex = /(?:TODO|FIXME)(?::|\s)(.*)/i;

        for (const file of files) {
            try {
                const fullPath = path.join(this.workspaceRoot, file);
                if (fs.existsSync(fullPath)) {
                    const stats = await fs.promises.stat(fullPath);
                    if (stats.isFile()) {
                        const content = await fs.promises.readFile(fullPath, 'utf8');
                        const lines = content.split('\n');
                        lines.forEach((lineContent, index) => {
                            const match = lineContent.match(todoRegex);
                            if (match) {
                                todos.push({
                                    file: file,
                                    line: index + 1,
                                    text: match[1].trim() || 'TODO'
                                });
                            }
                        });
                    }
                }
            } catch (error) {
                console.error(`Error reading file ${file} for TODOs`, error);
            }
        }
        return todos;
    }

    /**
     * Calculates the number of days between a given date and now.
     * @param {Date} date - The date to compare against.
     * @returns {number} The number of days.
     */
    private calculateDaysSince(date: Date): number {
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - date.getTime());
        return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    }
}
