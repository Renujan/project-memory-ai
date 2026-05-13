import * as vscode from 'vscode';
import { GitAnalyzer } from './gitAnalyzer';
import { MemoryStore } from './memoryStore';
import { AISummarizer } from './aiSummarizer';
import { ProjectMemoryProvider } from './webviewProvider';
import { registerCommands } from './commands';
import { CommitGenerator } from './commitGenerator';
import { StandupGenerator } from './standupGenerator';
import { MergeResolver } from './mergeResolver';

/**
 * Called when the extension is activated.
 * @param {vscode.ExtensionContext} context - The extension context.
 */
export async function activate(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    if (!workspaceRoot) {
        return; // Only activate if a workspace is open
    }

    try {
        // Initialize Core Logic Components
        const gitAnalyzer = new GitAnalyzer(workspaceRoot);
        const memoryStore = new MemoryStore(workspaceRoot);
        const aiSummarizer = new AISummarizer(context.secrets);
        const commitGenerator = new CommitGenerator(workspaceRoot, aiSummarizer);
        const standupGenerator = new StandupGenerator(workspaceRoot, gitAnalyzer, aiSummarizer);
        const mergeResolver = new MergeResolver(aiSummarizer);

        await memoryStore.initialize();

        // Initialize UI Provider
        const provider = new ProjectMemoryProvider(context.extensionUri);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(ProjectMemoryProvider.viewType, provider)
        );

        // Register Commands
        registerCommands(context, provider, memoryStore, gitAnalyzer, aiSummarizer, commitGenerator, standupGenerator, mergeResolver);

        // Auto-Trigger Logic
        await checkAutoTrigger(gitAnalyzer, memoryStore);
        
    } catch (error) {
        console.error("Failed to activate Project Memory AI", error);
    }
}

/**
 * Checks if the project has been inactive for 3+ days and triggers the memory panel.
 * @param {GitAnalyzer} gitAnalyzer - The git analyzer instance.
 * @param {MemoryStore} memoryStore - The memory store instance.
 */
async function checkAutoTrigger(gitAnalyzer: GitAnalyzer, memoryStore: MemoryStore) {
    try {
        const summary = await gitAnalyzer.getSummary();
        
        if (summary.daysSinceLastCommit >= 3) {
            // Check if we already showed it for this session/recent time
            const recentMemory = await memoryStore.getRecentMemory();
            const now = Date.now();
            const twelveHours = 12 * 60 * 60 * 1000;
            
            // Do not spam if already generated recently
            if (!recentMemory || (now - recentMemory.timestamp > twelveHours)) {
                vscode.window.showInformationMessage(`Welcome back! You haven't touched this project in ${summary.daysSinceLastCommit} days.`);
                vscode.commands.executeCommand('projectMemory.showPanel');
                
                // Trigger refresh to load AI summary after panel is visible
                setTimeout(() => {
                    vscode.commands.executeCommand('projectMemory.refresh');
                }, 1000);
            }
        }
    } catch (error) {
        // Silently ignore if not a git repo or other failure during auto-trigger check
        console.debug("Auto-trigger skipped:", error);
    }
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate() {}
