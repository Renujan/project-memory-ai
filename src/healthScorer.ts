import { GitSummary } from './gitAnalyzer';

export interface HealthScore {
    total: number;
    breakdown: HealthCategory[];
}

export interface HealthCategory {
    name: string;
    score: number;
    maxScore: number;
    status: 'good' | 'warning' | 'bad';
    issues: string[];
}

/**
 * HealthScorer class to calculate the code health score of the repository.
 */
export class HealthScorer {
    /**
     * Calculates the health score based on git summary data.
     * @param {GitSummary} data - The git summary.
     * @returns {HealthScore} The calculated health score and breakdown.
     */
    public calculateScore(data: GitSummary): HealthScore {
        const commitQuality = this.scoreCommitQuality(data);
        const todoDebt = this.scoreTodoDebt(data);
        const dangerZones = this.scoreDangerZones(data);
        const activity = this.scoreActivity(data);

        const total = commitQuality.score + todoDebt.score + dangerZones.score + activity.score;

        return {
            total,
            breakdown: [commitQuality, todoDebt, dangerZones, activity]
        };
    }

    private scoreCommitQuality(data: GitSummary): HealthCategory {
        const maxScore = 25;
        let score = maxScore;
        const issues: string[] = [];
        
        const recent = data.recentCommits.slice(0, 20);
        let shortCommits = 0;
        let genericCommits = 0;
        let conventionalCommits = 0;

        for (const commit of recent) {
            const msg = commit.message.toLowerCase();
            if (msg.length <= 10) {
                shortCommits++;
                score -= 2;
            }
            if (/^(fix|changes|update|data)$/i.test(msg)) {
                genericCommits++;
                score -= 3;
            }
            if (/^(feat|fix|refactor|style|docs|test|chore)(\([^)]+\))?:/.test(msg)) {
                conventionalCommits++;
            }
        }

        // Apply bonus for conventional commits (up to maxScore)
        if (conventionalCommits > 0) {
            score = Math.min(maxScore, score + (conventionalCommits * 1));
        }

        score = Math.max(0, score);

        if (shortCommits > 0) issues.push(`Found ${shortCommits} very short commit messages.`);
        if (genericCommits > 0) issues.push(`Found ${genericCommits} overly generic commit messages (e.g. "fix", "update").`);
        if (conventionalCommits === 0 && recent.length > 0) issues.push(`Not using Conventional Commits format.`);

        let status: 'good' | 'warning' | 'bad' = 'good';
        if (score < 15) status = 'bad';
        else if (score < 20) status = 'warning';

        return {
            name: 'Commit Quality',
            score,
            maxScore,
            status,
            issues
        };
    }

    private scoreTodoDebt(data: GitSummary): HealthCategory {
        const maxScore = 25;
        let score = 25;
        const count = data.todos.length;
        const issues: string[] = [];

        if (count === 0) {
            score = 25;
        } else if (count <= 3) {
            score = 20;
            issues.push(`${count} TODOs found.`);
        } else if (count <= 10) {
            score = 10;
            issues.push(`Moderate TODO debt (${count} TODOs).`);
        } else {
            score = 0;
            issues.push(`High TODO debt (${count} TODOs).`);
        }

        let status: 'good' | 'warning' | 'bad' = 'good';
        if (score === 0) status = 'bad';
        else if (score === 10) status = 'warning';

        return {
            name: 'TODO Debt',
            score,
            maxScore,
            status,
            issues
        };
    }

    private scoreDangerZones(data: GitSummary): HealthCategory {
        const maxScore = 25;
        let score = 25;
        const count = data.dangerZoneFiles.length;
        const issues: string[] = [];

        if (count === 0) {
            score = 25;
        } else if (count <= 2) {
            score = 18;
            issues.push(`${count} danger zones found.`);
        } else if (count <= 5) {
            score = 10;
            issues.push(`Moderate risk: ${count} danger zones.`);
        } else {
            score = 0;
            issues.push(`High risk: ${count} danger zones.`);
        }

        let status: 'good' | 'warning' | 'bad' = 'good';
        if (score === 0) status = 'bad';
        else if (score === 10) status = 'warning';

        return {
            name: 'Danger Zones',
            score,
            maxScore,
            status,
            issues
        };
    }

    private scoreActivity(data: GitSummary): HealthCategory {
        const maxScore = 25;
        let score = 25;
        const days = data.daysSinceLastCommit;
        const issues: string[] = [];

        if (days <= 7) {
            score = 25;
        } else if (days <= 30) {
            score = 18;
            issues.push(`No activity in the last ${days} days.`);
        } else if (days <= 90) {
            score = 10;
            issues.push(`Project is becoming stale (${days} days inactive).`);
        } else {
            score = 5;
            issues.push(`Project is highly inactive (${days} days).`);
        }

        let status: 'good' | 'warning' | 'bad' = 'good';
        if (score === 5) status = 'bad';
        else if (score <= 18) status = 'warning';

        return {
            name: 'Activity',
            score,
            maxScore,
            status,
            issues
        };
    }
}
