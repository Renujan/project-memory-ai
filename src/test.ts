import { GitAnalyzer } from './gitAnalyzer';
import * as path from 'path';

async function run() {
    try {
        console.log("Starting GitAnalyzer test...");
        // Use the current directory (project-memory-ai itself) 
        // Wait, project-memory-ai doesn't have git history yet because we just created it.
        // Let's use the parent workspace e:\appz\project\connect-spark-871 since we know it's a project,
        // or just initialize git here for testing.
        const analyzer = new GitAnalyzer(process.cwd());
        const summary = await analyzer.getSummary();
        console.log("Summary:", JSON.stringify(summary, null, 2));
    } catch (e) {
        console.error("Test failed:", e);
    }
}

run();
