import { simpleGit, SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { HealthScore, HealthScorer } from './healthScorer';

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
    uncommittedFiles: string[];
    todos: TodoItem[];
    dangerZoneFiles: DangerZoneFile[];
    healthScore?: HealthScore;
    activityDates: string[];
}

export interface TodoItem {
    file: string;
    line: number;
    text: string;
}

export interface DangerZoneFile {
    file: string;
    bugFixCount: number;
    lastBugCommit: string;
    lastBugDate: string;
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
            
            const status = await this.git.status();
            const uncommittedFilesRaw = new Set([...status.not_added, ...status.created, ...status.deleted, ...status.modified, ...status.renamed.map(r => r.to)]);
            const uncommittedFiles = Array.from(uncommittedFilesRaw).filter(f => !f.toLowerCase().endsWith('.pyc') && !f.includes('__pycache__'));

            const todos = await this.extractTodos(filesChangedLastSession);
            const dangerZoneFiles = await this.getDangerZoneFiles();
            
            // Get dates for 30-day heatmap
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const last30dLog = await this.git.log({ '--after': thirtyDaysAgo });
            const activityDates = last30dLog.all.map(c => c.date);

            const summaryWithoutHealth: GitSummary = {
                branch,
                daysSinceLastCommit,
                lastCommitDate,
                recentCommits,
                filesChangedLastSession,
                uncommittedFiles,
                todos,
                dangerZoneFiles,
                activityDates
            };

            const scorer = new HealthScorer();
            summaryWithoutHealth.healthScore = scorer.calculateScore(summaryWithoutHealth);

            return summaryWithoutHealth;
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
            return this.filterFiles(Array.from(allFiles));
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
            if (file.includes('node_modules') || file.includes('.git/')) continue;
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

    /**
     * Filters out useless files from a list of paths and prioritizes certain extensions.
     * @param {string[]} files - List of file paths to filter.
     * @returns {string[]} Filtered list of up to 10 files.
     */
    private filterFiles(files: string[]): string[] {
        const excludedExtensions = ['.pyc', '.pyo', '.map', '.log', '.vsix'];
        const excludedPaths = ['__pycache__', '.vscode/project-memory', 'node_modules', '.git/'];
        
        const filtered = files.filter(file => {
            const lowerFile = file.toLowerCase();
            const hasExcludedExt = excludedExtensions.some(ext => lowerFile.endsWith(ext));
            const hasExcludedPath = excludedPaths.some(p => file.includes(p));
            return !hasExcludedExt && !hasExcludedPath;
        });

        const priorityExts = ['.py', '.ts', '.js', '.html', '.css', '.json'];
        
        filtered.sort((a, b) => {
            const aExt = path.extname(a).toLowerCase();
            const bExt = path.extname(b).toLowerCase();
            const aPrio = priorityExts.includes(aExt) ? 1 : 0;
            const bPrio = priorityExts.includes(bExt) ? 1 : 0;
            return bPrio - aPrio;
        });

        return filtered.slice(0, 10);
    }

    /**
     * Finds files that were involved in past bug-fix commits.
     * @returns {Promise<DangerZoneFile[]>} List of files that caused bugs.
     */
    public async getDangerZoneFiles(): Promise<DangerZoneFile[]> {
        try {
            const log = await this.git.log();
            const bugKeywords = ['fix', 'bug', 'error', 'broken', 'crash', 'issue', 'hotfix', 'patch'];
            
            const bugCommits = log.all.filter(commit => {
                const msg = commit.message.toLowerCase();
                return bugKeywords.some(keyword => msg.includes(keyword));
            });

            const fileStats = new Map<string, { count: number; lastCommit: string; lastDate: string }>();

            // We only check the last 50 bug commits to keep it fast
            for (const commit of bugCommits.slice(0, 50)) {
                try {
                    const show = await this.git.show(['--name-only', '--format=', commit.hash]);
                    const files = show.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                    const filteredFiles = this.filterFiles(files);
                    
                    for (const file of filteredFiles) {
                        if (!fileStats.has(file)) {
                            fileStats.set(file, { count: 1, lastCommit: commit.message, lastDate: commit.date });
                        } else {
                            const stat = fileStats.get(file);
                            if (stat) {
                                stat.count++;
                            }
                        }
                    }
                } catch (e) {
                    // Ignore errors for individual commits
                }
            }

            const dangerFiles: DangerZoneFile[] = [];
            for (const [file, stat] of fileStats.entries()) {
                dangerFiles.push({
                    file,
                    bugFixCount: stat.count,
                    lastBugCommit: stat.lastCommit,
                    lastBugDate: stat.lastDate
                });
            }

            // Sort by count descending
            dangerFiles.sort((a, b) => b.bugFixCount - a.bugFixCount);
            
            return dangerFiles.slice(0, 10); // Return top 10 most bug-prone files
        } catch (error) {
            console.error("Failed to get danger zone files", error);
            return [];
        }
    }
}
