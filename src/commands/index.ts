import * as vscode from 'vscode';
import { ProjectMemoryProvider } from '../webviewProvider';
import { GitAnalyzer } from '../gitAnalyzer';
import { AISummarizer, AISummaryResult } from '../aiSummarizer';
import { MemoryStore } from '../memoryStore';
import { CommitGenerator } from '../commitGenerator';
import { StandupGenerator } from '../standupGenerator';
import { MergeResolver, MergeConflict } from '../mergeResolver';

/**
 * Registers all extension commands.
 * @param {vscode.ExtensionContext} context - The extension context.
 * @param {ProjectMemoryProvider} provider - The webview provider.
 * @param {MemoryStore} memoryStore - The local vector storage.
 * @param {GitAnalyzer} gitAnalyzer - The git history analyzer.
 * @param {AISummarizer} aiSummarizer - The AI summarizer.
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    provider: ProjectMemoryProvider,
    memoryStore: MemoryStore,
    gitAnalyzer: GitAnalyzer,
    aiSummarizer: AISummarizer,
    commitGenerator: CommitGenerator,
    standupGenerator: StandupGenerator,
    mergeResolver: MergeResolver
) {
    let currentConflicts: MergeConflict[] = [];
    // 1. Show Panel Command
    context.subscriptions.push(vscode.commands.registerCommand('projectMemory.showPanel', async () => {
        vscode.commands.executeCommand('workbench.view.extension.project-memory-ai-sidebar');
    }));

    // 2. Refresh Command
    context.subscriptions.push(vscode.commands.registerCommand('projectMemory.refresh', async () => {
        try {
            const gitSummary = await gitAnalyzer.getSummary();
            const recentMemory = await memoryStore.getRecentMemory();
            currentConflicts = await mergeResolver.detectConflicts();
            
            let cachedAiSummary: AISummaryResult | undefined = undefined;
            if (recentMemory && recentMemory.summary) {
                cachedAiSummary = {
                    paragraph: recentMemory.summary,
                    suggestions: recentMemory.suggestions || []
                };
            }

            // Immediately show UI with cached summary and "Refreshing..." badge
            provider.updateView(gitSummary, cachedAiSummary, true, currentConflicts);

            // Fetch new summary from Groq in background
            const aiSummary = await aiSummarizer.generateSummary(gitSummary);

            // Save new summary to memory
            await memoryStore.saveMemory({
                timestamp: Date.now(),
                summary: aiSummary.paragraph,
                suggestions: aiSummary.suggestions,
                filesEdited: gitSummary.filesChangedLastSession,
                todosRemaining: gitSummary.todos.length
            });

            // Update UI silently with new AI summary
            provider.updateView(gitSummary, aiSummary, false, currentConflicts);

        } catch (error: any) {
            provider.showError(error.message || "An unknown error occurred.");
            vscode.window.showErrorMessage(`Project Memory AI Error: ${error.message}`);
        }
    }));

    // 3. Set Groq Key
    context.subscriptions.push(vscode.commands.registerCommand('projectMemory.setGroqKey', async () => {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Groq API Key',
            password: true,
            ignoreFocusOut: true
        });

        if (key) {
            await context.secrets.store('projectMemory.groqApiKey', key);
            vscode.window.showInformationMessage('Groq API Key saved successfully.');
        }
    }));

    // 4. Clear Memory
    context.subscriptions.push(vscode.commands.registerCommand('projectMemory.clearMemory', async () => {
        try {
            await memoryStore.clearMemory();
            vscode.window.showInformationMessage('Project Memory cleared.');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to clear Project Memory.');
        }
    }));

    // 5. Generate Commit Message
    context.subscriptions.push(vscode.commands.registerCommand('projectMemory.generateCommit', async () => {
        try {
            const changes = await commitGenerator.getUnstagedChanges();
            if (changes.length === 0) {
                vscode.window.showInformationMessage('No uncommitted changes found.');
                provider.sendCommitMessage('');
                return;
            }
            const message = await commitGenerator.generateCommitMessage(changes);
            provider.sendCommitMessage(message);
        } catch (error: any) {
            provider.sendCommitMessage(`Error: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to generate commit message: ${error.message}`);
        }
    }));

    // 6. Show Health Score
    context.subscriptions.push(vscode.commands.registerCommand('projectMemory.showHealthScore', async () => {
        // Since health score is automatically generated and displayed in the panel,
        // we just ensure the panel is visible.
        vscode.commands.executeCommand('projectMemory.showPanel');
        vscode.window.showInformationMessage('Check the Project Memory panel to see your full Code Health Score breakdown!');
    }));

    // 7. Generate Daily Standup
    context.subscriptions.push(vscode.commands.registerCommand('projectMemory.generateStandup', async () => {
        try {
            const standup = await standupGenerator.generateStandup();
            const slackFormat = standupGenerator.formatAsSlack(standup);
            const plainFormat = standupGenerator.formatAsPlain(standup);
            provider.sendStandupMessage(slackFormat, plainFormat);
        } catch (error: any) {
            provider.sendStandupMessage(`Error generating standup: ${error.message}`, `Error generating standup: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to generate standup: ${error.message}`);
        }
    }));

    // 8. Detect Conflicts (Explicit command, though also run on refresh)
    context.subscriptions.push(vscode.commands.registerCommand('projectMemory.detectConflicts', async () => {
        currentConflicts = await mergeResolver.detectConflicts();
        if (currentConflicts.length > 0) {
            vscode.commands.executeCommand('projectMemory.refresh');
        } else {
            vscode.window.showInformationMessage('No merge conflicts found.');
        }
    }));

    // 9. Analyze Conflict
    context.subscriptions.push(vscode.commands.registerCommand('projectMemory.analyzeConflict', async (index: number) => {
        try {
            const conflict = currentConflicts.find(c => c.index === index);
            if (!conflict) return;

            const resolution = await mergeResolver.resolveConflict(conflict);
            
            // Store AI recommended code
            (conflict as any).aiMergedCode = resolution.mergedCode;
            
            provider.sendConflictAnalyzed(index, resolution.recommendation, resolution.explanation);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to analyze conflict: ${error.message}`);
        }
    }));

    // 10. Resolve Conflict
    context.subscriptions.push(vscode.commands.registerCommand('projectMemory.resolveConflict', async (index: number, action: 'ours' | 'theirs' | 'ai') => {
        try {
            const conflict = currentConflicts.find(c => c.index === index);
            if (!conflict) return;

            let mergedCode = '';
            if (action === 'ours') mergedCode = conflict.ourCode;
            else if (action === 'theirs') mergedCode = conflict.theirCode;
            else if (action === 'ai') mergedCode = (conflict as any).aiMergedCode || conflict.ourCode;

            await mergeResolver.applyResolution({
                conflict,
                recommendation: 'manual',
                explanation: '',
                mergedCode
            });

            provider.sendConflictResolved(index);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to resolve conflict: ${error.message}`);
        }
    }));

    // 11. Resolve All Conflicts
    context.subscriptions.push(vscode.commands.registerCommand('projectMemory.resolveAllConflicts', async () => {
        try {
            provider.sendResolvingAllProgress('Resolving with AI... ↻');
            
            for (let i = 0; i < currentConflicts.length; i++) {
                const conflict = currentConflicts[i];
                provider.sendResolvingAllProgress(`Resolving ${i + 1} of ${currentConflicts.length}...`);
                
                const resolution = await mergeResolver.resolveConflict(conflict);
                await mergeResolver.applyResolution(resolution);
                provider.sendConflictResolved(conflict.index);
            }

            provider.sendAllConflictsResolved();
            currentConflicts = []; // Clear state
            vscode.window.showInformationMessage('All merge conflicts resolved successfully!');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to resolve all conflicts: ${error.message}`);
            provider.sendResolvingAllProgress('Resolve All with AI'); // Reset button
        }
    }));
}
