import * as vscode from 'vscode';
import { GitSummary } from './gitAnalyzer';
import { AISummaryResult } from './aiSummarizer';
import { MergeConflict } from './mergeResolver';
import * as path from 'path';

export class ProjectMemoryProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'projectMemoryPanel';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // To prevent VS Code's "InvalidStateError: Failed to register a ServiceWorker" race condition,
        // we do NOT set an initial loading HTML here. We let the refresh command set it once.
        vscode.commands.executeCommand('projectMemory.refresh');

        // Listen for messages
        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.command) {
                case 'refresh':
                    vscode.commands.executeCommand('projectMemory.refresh');
                    break;
                case 'openFile':
                    await this.openFile(data.file);
                    break;
                case 'openTodo':
                    await this.openFile(data.file, data.line);
                    break;
                case 'generateCommit':
                    vscode.commands.executeCommand('projectMemory.generateCommit');
                    break;
                case 'copyCommit':
                    vscode.env.clipboard.writeText(data.text);
                    break;
                case 'generateStandup':
                    vscode.commands.executeCommand('projectMemory.generateStandup');
                    break;
                case 'resolveConflict':
                    vscode.commands.executeCommand('projectMemory.resolveConflict', data.index, data.action);
                    break;
                case 'analyzeConflict':
                    vscode.commands.executeCommand('projectMemory.analyzeConflict', data.index);
                    break;
                case 'resolveAllConflicts':
                    vscode.commands.executeCommand('projectMemory.resolveAllConflicts');
                    break;
            }
        });
    }

    public updateView(gitSummary: GitSummary, aiSummary?: AISummaryResult, isRefreshing: boolean = false, conflicts?: MergeConflict[]) {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview, gitSummary, aiSummary, isRefreshing, conflicts);
        }
    }

    public showLoading() {
        if (this._view) {
            this._view.webview.html = this._getLoadingHtml();
        }
    }

    public showError(message: string) {
        if (this._view) {
            this._view.webview.html = this._getErrorHtml(message);
        }
    }

    public sendCommitMessage(text: string) {
        if (this._view) {
            this._view.webview.postMessage({ command: 'commitGenerated', text });
        }
    }

    public sendStandupMessage(slack: string, plain: string) {
        if (this._view) {
            this._view.webview.postMessage({ command: 'standupGenerated', slack, plain });
        }
    }

    public sendConflictAnalyzed(index: number, recommendation: string, explanation: string) {
        if (this._view) {
            this._view.webview.postMessage({ command: 'conflictAnalyzed', index, recommendation, explanation });
        }
    }

    public sendConflictResolved(index: number) {
        if (this._view) {
            this._view.webview.postMessage({ command: 'conflictResolved', index });
        }
    }

    public sendAllConflictsResolved() {
        if (this._view) {
            this._view.webview.postMessage({ command: 'allConflictsResolved' });
        }
    }

    public sendResolvingAllProgress(text: string) {
        if (this._view) {
            this._view.webview.postMessage({ command: 'resolvingAllProgress', text });
        }
    }

    /**
     * Opens a file in the editor and optionally jumps to a specific line.
     * @param {string} filePath - The path to the file.
     * @param {number} [line] - The line number to jump to.
     */
    private async openFile(filePath: string, line?: number) {
        if (!vscode.workspace.workspaceFolders) { return; }
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const fullPath = path.join(root, filePath);
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
            const editor = await vscode.window.showTextDocument(document);
            if (line !== undefined) {
                const position = new vscode.Position(line - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
        }
    }

    private _getHtmlForWebview(
        _webview: vscode.Webview, 
        git?: GitSummary, 
        ai?: AISummaryResult, 
        _isRefreshing: boolean = false,
        conflicts: MergeConflict[] = []
    ) {
        if (!git) {
            return this._getLoadingHtml();
        }

        const displayAi = ai || { paragraph: 'Generating AI summary...', suggestions: [] };
        
        // --- Header Logic ---
        let badgeColorClass = 'badge-green';
        if (git.daysSinceLastCommit > 30) badgeColorClass = 'badge-red';
        else if (git.daysSinceLastCommit >= 7) badgeColorClass = 'badge-orange';
        
        const lastActiveDate = git.lastCommitDate ? new Date(git.lastCommitDate).toLocaleDateString() : 'Unknown';

        // --- Git Timeline ---
        const commitsHtml = git.recentCommits.slice(0, 10).map((c, i) => `
            <div class="timeline-item animate-item ${i === 0 ? 'timeline-item-latest' : ''}" style="transition-delay: ${i * 0.05}s">
                <div class="timeline-marker"></div>
                <div class="commit-msg" title="${c.message}">${c.message}</div>
                <div class="commit-meta">${new Date(c.date).toLocaleDateString()} - ${c.author_name}</div>
            </div>
        `).join('') || '<div class="empty-state">No recent commits.</div>';

        // --- Recent Files ---
        const filesHtml = git.filesChangedLastSession.slice(0, 10).map((f, i) => {
            const ext = path.extname(f).toLowerCase();
            let icon = '<i class="ph ph-file"></i>';
            if (ext === '.py') icon = '<i class="ph ph-file-code"></i>';
            else if (ext === '.ts') icon = '<i class="ph ph-file-ts"></i>';
            else if (ext === '.js') icon = '<i class="ph ph-file-js"></i>';
            else if (ext === '.html') icon = '<i class="ph ph-file-html"></i>';
            else if (ext === '.css') icon = '<i class="ph ph-file-css"></i>';
            
            const name = path.basename(f);
            const dir = path.dirname(f);
            const dirDisplay = dir === '.' ? '' : `<div class="item-meta">${dir}</div>`;

            return `
            <div class="list-item animate-item" style="transition-delay: ${i * 0.05}s">
                <div class="icon">${icon}</div>
                <div class="list-content" onclick="openFile('${f.replace(/\\/g, '\\\\')}')">
                    <div class="item-title">${name}</div>
                    ${dirDisplay}
                </div>
                <div class="file-actions">
                    <button class="file-action-btn" title="View Diff" onclick="openFile('${f.replace(/\\/g, '\\\\')}')"><i class="ph ph-eye"></i></button>
                    <button class="file-action-btn" title="Open to Side" onclick="openFile('${f.replace(/\\/g, '\\\\')}')"><i class="ph ph-arrow-square-out"></i></button>
                </div>
            </div>`;
        }).join('') || '<div class="empty-state">No recent files.</div>';

        // --- TODOs ---
        const todosHtml = git.todos.slice(0, 10).map((t, i) => {
            const name = path.basename(t.file);
            return `
            <div class="list-item animate-item" onclick="openTodo('${t.file.replace(/\\/g, '\\\\')}', ${t.line})" style="transition-delay: ${i * 0.05}s">
                <div class="todo-dot"></div>
                <div class="list-content todo-content">
                    <div class="item-title">${t.text}</div>
                    <div class="item-meta right-align">${name}:${t.line}</div>
                </div>
            </div>`;
        }).join('') || '<div class="empty-state">No TODOs found. Clean codebase! ✨</div>';

        // --- Danger Zones ---
        const filteredDangerFiles = (git.dangerZoneFiles || []).filter(d => !d.file.toLowerCase().endsWith('.pyc') && !d.file.includes('__pycache__'));
        const dangerZonesHtml = filteredDangerFiles.length > 0 ? filteredDangerFiles.slice(0, 10).map((d, i) => {
            const name = path.basename(d.file);
            return `
            <div class="list-item danger-item animate-item" onclick="openFile('${d.file.replace(/\\/g, '\\\\')}')" style="transition-delay: ${i * 0.05}s">
                <div class="icon"><i class="ph ph-warning"></i></div>
                <div class="list-content">
                    <div class="danger-title">${name}</div>
                    <div class="item-meta danger-meta">${d.bugFixCount} fixes • Last: ${d.lastBugCommit}</div>
                </div>
            </div>`;
        }).join('') : '';

        const dangerZonesSection = dangerZonesHtml ? `
        <div class="accordion animate-on-scroll">
            <div class="accordion-header danger-bg" onclick="toggleAccordion('danger')">
                <span style="color: var(--vscode-errorForeground); font-weight: bold;"><i class="ph ph-warning"></i> Danger Zones (${filteredDangerFiles.length})</span>
                <span class="chevron" id="chev-danger"><i class="ph ph-caret-down"></i></span>
            </div>
            <div class="accordion-content" id="acc-danger">
                ${dangerZonesHtml}
            </div>
        </div>` : '';

        // --- AI Suggestions ---
        const suggestionsHtml = displayAi.suggestions.map((s, i) => `
            <li class="suggestion-item animate-item" style="transition-delay: ${i * 0.1}s">
                <span class="suggestion-badge">${i + 1}</span>
                <span class="suggestion-text">${s}</span>
            </li>
        `).join('');

        // --- Merge Conflicts ---
        let mergeConflictsHtml = '';
        if (conflicts && conflicts.length > 0) {
            const getLanguageClass = (filename: string) => {
                const ext = path.extname(filename).toLowerCase();
                if (ext === '.ts' || ext === '.tsx') return 'language-typescript';
                if (ext === '.js' || ext === '.jsx') return 'language-javascript';
                if (ext === '.py') return 'language-python';
                if (ext === '.css') return 'language-css';
                if (ext === '.html') return 'language-markup';
                return 'language-plaintext';
            };

            const conflictCards = conflicts.map(c => {
                const langClass = getLanguageClass(c.file);
                return `
                <div class="conflict-card animate-on-scroll" id="conflict-${c.index}">
                    <div class="conflict-header">${path.basename(c.file)}: Line ${c.startLine + 1}</div>
                    <div class="conflict-split">
                        <div class="conflict-side">
                            <div class="conflict-side-header green">OUR VERSION</div>
                            <pre class="conflict-code"><code class="${langClass}">${c.ourCode.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
                        </div>
                        <div class="conflict-side">
                            <div class="conflict-side-header blue">THEIR VERSION</div>
                            <pre class="conflict-code"><code class="${langClass}">${c.theirCode.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
                        </div>
                    </div>
                    <div id="conflict-rec-${c.index}" class="conflict-rec" style="display: none;"></div>
                    <div class="conflict-actions">
                        <button class="conflict-btn ours" onclick="resolveConflict(${c.index}, 'ours')">Accept Ours</button>
                        <button class="conflict-btn theirs" onclick="resolveConflict(${c.index}, 'theirs')">Accept Theirs</button>
                        <button class="conflict-btn ai" onclick="analyzeConflict(this, ${c.index})">Analyze with AI</button>
                        <button id="use-ai-${c.index}" class="conflict-btn ai-use" style="display: none;" onclick="resolveConflict(${c.index}, 'ai')">Use AI Suggestion</button>
                    </div>
                </div>`;
            }).join('');

            mergeConflictsHtml = `
            <div class="merge-section animate-on-scroll">
                <h2 class="merge-heading"><i class="ph ph-git-merge"></i> MERGE CONFLICTS DETECTED</h2>
                <div class="merge-banner">
                    ${conflicts.length} conflict(s) found. AI can help resolve them.
                </div>
                ${conflictCards}
                <button class="conflict-btn resolve-all btn-primary" id="resolve-all-btn" onclick="resolveAllConflicts(this)">
                    <span class="btn-text">Resolve All with AI</span>
                    <span class="btn-spinner" style="display:none;"><i class="ph ph-spinner-gap"></i></span>
                </button>
            </div>`;
        }

        // --- Commit Helper ---
        const hasUncommitted = git.uncommittedFiles && git.uncommittedFiles.length > 0;
        const commitHelperHtml = hasUncommitted ? `
            <div class="commit-card animate-on-scroll">
                <h2 class="commit-heading"><i class="ph ph-chat-centered-text"></i> Commit Helper</h2>
                <div class="commit-files-list">
                    ${git.uncommittedFiles.slice(0, 5).map(f => `<span class="commit-file-badge"><i class="ph ph-file"></i> ${path.basename(f)}</span>`).join('')}
                    ${git.uncommittedFiles.length > 5 ? `<span class="commit-file-badge">+${git.uncommittedFiles.length - 5} more</span>` : ''}
                </div>
                <textarea id="commit-msg-input" placeholder="Generated commit message will appear here..."></textarea>
                <div class="commit-actions">
                    <button class="commit-btn btn-primary" onclick="generateCommit(this)">
                        <span class="btn-icon" id="gen-commit-icon"><i class="ph ph-magic-wand"></i></span>
                        <span class="btn-text">Generate Message</span>
                        <span class="btn-spinner" style="display:none;"><i class="ph ph-spinner-gap"></i></span>
                    </button>
                    <button class="commit-btn btn-secondary copy-btn" onclick="copyCommit(this, 'commit-msg-input')">
                        <span class="btn-icon"><i class="ph ph-copy"></i></span>
                        <span class="btn-text">Copy</span>
                    </button>
                </div>
            </div>` : '<div class="empty-state animate-on-scroll">No uncommitted changes. You are all caught up! <i class="ph ph-sparkle"></i></div>';

        // --- Code Health SVG ---
        let healthHtml = '';
        let healthScoreValue = 0;
        if (git.healthScore) {
            healthScoreValue = git.healthScore.total;
            let hexColor = '#f43f5e'; // red
            let statusText = 'Critical';
            
            if (healthScoreValue > 75) { hexColor = '#10b981'; statusText = 'Excellent'; } // green
            else if (healthScoreValue > 60) { hexColor = '#f59e0b'; statusText = 'Good'; } // orange
            else if (healthScoreValue > 40) { hexColor = '#f59e0b'; statusText = 'Needs Work'; }
            
            const getIcon = (name: string) => {
                if (name === 'Commit Quality') return '<i class="ph ph-chat-text"></i>';
                if (name === 'TODO Debt') return '<i class="ph ph-push-pin"></i>';
                if (name === 'Danger Zones') return '<i class="ph ph-warning-circle"></i>';
                if (name === 'Activity') return '<i class="ph ph-lightning"></i>';
                return '<i class="ph ph-dot"></i>';
            };

            const breakdownHtml = git.healthScore.breakdown.map(cat => {
                const percentage = (cat.score / cat.maxScore) * 100;
                let barColorClass = 'green';
                if (cat.status === 'warning') barColorClass = 'orange';
                if (cat.status === 'bad') barColorClass = 'red';

                return `
                <div class="health-row">
                    <div class="health-row-label">${getIcon(cat.name)} ${cat.name}</div>
                    <div class="health-bar-container">
                        <div class="health-bar-fill ${barColorClass}" style="width: ${percentage}%"></div>
                    </div>
                    <div class="health-row-score">${cat.score}/${cat.maxScore}</div>
                </div>`;
            }).join('');

            healthHtml = `
            <div class="health-section animate-on-scroll">
                <h2><i class="ph ph-heartbeat"></i> CODE HEALTH</h2>
                <div class="health-circle-container">
                    <svg class="health-svg" viewBox="0 0 120 120">
                        <circle class="svg-bg" cx="60" cy="60" r="54"></circle>
                        <circle class="svg-progress" cx="60" cy="60" r="54" id="health-circle-svg" style="stroke: ${hexColor};"></circle>
                        <text x="60" y="72" class="svg-text" id="health-score-text" fill="${hexColor}">0</text>
                    </svg>
                    <div class="health-status-text" style="color: ${hexColor}">${statusText}</div>
                </div>
                <div class="health-breakdown">
                    ${breakdownHtml}
                </div>
            </div>`;
        }

        // --- Heatmap Logic ---
        const today = new Date();
        today.setHours(0,0,0,0);
        const heatmapHtml = Array.from({length: 30}).map((_, i) => {
            const d = new Date(today.getTime() - (29 - i) * 24 * 60 * 60 * 1000);
            const dateStr = d.toISOString().split('T')[0];
            const commitsThatDay = (git.activityDates || []).filter(ad => ad.startsWith(dateStr)).length;
            
            let colorClass = 'heat-0';
            if (commitsThatDay === 1) colorClass = 'heat-1';
            else if (commitsThatDay >= 2 && commitsThatDay <= 3) colorClass = 'heat-2';
            else if (commitsThatDay >= 4) colorClass = 'heat-3';

            return `<div class="heatmap-square ${colorClass}" title="${dateStr}: ${commitsThatDay} commits"></div>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com;">
    <title>Project Memory AI</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet" />
    <script src="https://unpkg.com/@phosphor-icons/web"></script>
    <style>
        :root {
            --anim-duration: 0.3s;
            --tab-bg: var(--vscode-sideBar-background);
            --tab-border: var(--vscode-panel-border);
            --accent: var(--vscode-activityBarBadge-background);
            --accent-fg: var(--vscode-activityBarBadge-foreground);
        }

        body {
            font-family: var(--vscode-font-family);
            padding: 0; margin: 0;
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            line-height: 1.5; overflow-x: hidden;
        }

        .container { padding: 16px; padding-top: 70px; }

        @media (prefers-reduced-motion: reduce) {
            * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
                scroll-behavior: auto !important;
            }
        }

        h2 { 
            font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
            margin: 20px 0 12px 0; color: var(--vscode-editorGhostText-foreground); font-weight: 600;
        }

        .animate-on-scroll, .animate-item {
            opacity: 0; transform: translateY(16px); transition: opacity 0.4s ease, transform 0.4s ease;
        }
        .animate-on-scroll.visible, .animate-item.visible { opacity: 1; transform: translateY(0); }

        .tab-bar {
            position: fixed; top: 0; left: 0; width: 100%; display: flex;
            background: var(--tab-bg); border-bottom: 1px solid var(--tab-border); z-index: 100; height: 60px;
        }
        .tab {
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-size: 11px; color: var(--vscode-descriptionForeground); cursor: pointer; transition: color 0.2s; padding-bottom: 4px;
        }
        .tab.active { color: var(--vscode-foreground); font-weight: bold; }
        .tab-icon { font-size: 18px; margin-bottom: 2px; }
        .tab-indicator {
            position: absolute; bottom: 0; left: 0; height: 3px; background: var(--accent);
            width: 25%; transition: left 0.25s cubic-bezier(0.4, 0, 0.2, 1); border-top-left-radius: 3px; border-top-right-radius: 3px;
        }
        .tab-content { display: none; opacity: 0; transition: opacity 0.2s ease; }
        .tab-content.active { display: block; opacity: 1; }

        .header { 
            margin-bottom: 24px; background: linear-gradient(135deg, var(--vscode-editor-inactiveSelectionBackground), transparent);
            padding: 16px; border-radius: 12px; border: 1px solid var(--vscode-panel-border); box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .header-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .title { font-weight: 800; font-size: 14px; font-variant: small-caps; letter-spacing: 0.5px; }
        .badge { padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .badge.red, .badge-red { background: var(--vscode-testing-iconFailed); color: var(--vscode-editor-background); }
        .badge.orange, .badge-orange { background: var(--vscode-testing-iconQueued); color: var(--vscode-editor-background); }
        .badge.green, .badge-green { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
        .header-bottom { font-size: 12px; color: var(--vscode-descriptionForeground); display: flex; align-items: center; gap: 8px; }

        .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
        .stat-box { 
            background: var(--vscode-editor-inactiveSelectionBackground); padding: 16px 8px; border-radius: 12px; text-align: center; 
            border: 1px solid var(--vscode-panel-border); box-shadow: 0 2px 8px rgba(0,0,0,0.05); transition: transform 0.2s, box-shadow 0.2s;
        }
        .stat-box:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .stat-value { font-size: 20px; font-weight: bold; margin-bottom: 4px; color: var(--vscode-editor-foreground); }
        .stat-label { font-size: 10px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; }

        .accordion { margin-bottom: 16px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; overflow: hidden; background: var(--vscode-editor-inactiveSelectionBackground); }
        .accordion-header {
            display: flex; justify-content: space-between; align-items: center;
            padding: 12px 16px; cursor: pointer; font-size: 12px; font-weight: bold;
            background: var(--vscode-editor-inactiveSelectionBackground); transition: filter 0.2s;
        }
        .accordion-header.danger-bg { background: var(--vscode-inputValidation-errorBackground); }
        .accordion-header:hover { filter: brightness(1.1); }
        .chevron { transition: transform 0.25s ease; font-size: 10px; }
        .chevron.open { transform: rotate(180deg); }
        .accordion-content {
            max-height: 0; overflow: hidden; opacity: 0;
            transition: max-height 0.35s ease, opacity 0.25s ease, padding 0.35s ease;
            background: var(--vscode-editor-background);
        }
        .accordion-content.open { max-height: 2000px; opacity: 1; padding: 12px 8px; }

        .ai-card, .standup-card, .commit-card { 
            background: var(--vscode-editor-inactiveSelectionBackground); 
            padding: 16px; border-radius: 12px; border: 1px solid var(--vscode-panel-border);
            box-shadow: 0 2px 8px rgba(0,0,0,0.05); margin-bottom: 16px;
        }
        .ai-card p { margin-top: 0; font-size: 13px; }
        .suggestions-list { list-style: none; padding: 0; margin: 16px 0 0 0; }
        .suggestion-item { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
        .suggestion-item:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
        .suggestion-badge { background: linear-gradient(135deg, var(--accent), var(--vscode-textLink-foreground)); color: var(--accent-fg); font-size: 10px; font-weight: bold; border-radius: 6px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        .suggestion-text { font-size: 13px; line-height: 1.4; }

        .list-item { 
            display: flex; align-items: center; padding: 10px 12px; 
            background: var(--vscode-editor-inactiveSelectionBackground); margin-bottom: 8px; 
            border-radius: 8px; border: 1px solid transparent; transition: border-color 0.2s, background 0.2s; position: relative;
        }
        .list-item:hover { background: var(--vscode-list-hoverBackground); border-color: var(--vscode-panel-border); }
        .list-content { flex: 1; overflow: hidden; cursor: pointer; }
        .todo-content { display: flex; justify-content: space-between; align-items: center; flex-direction: row; }
        .item-title { font-weight: bold; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .item-meta { font-size: 11px; color: var(--vscode-descriptionForeground); }
        .todo-dot { width: 8px; height: 8px; border-radius: 50%; background-color: #f59e0b; flex-shrink: 0; margin-right: 12px; }
        
        .file-actions { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); display: flex; gap: 4px; opacity: 0; transition: opacity 0.2s; }
        .list-item:hover .file-actions { opacity: 1; }
        .file-action-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 12px; height: 24px; padding: 0 8px; cursor: pointer; font-size: 12px; transition: filter 0.2s; }
        .file-action-btn:hover { filter: brightness(1.2); }

        .danger-item { background: var(--vscode-inputValidation-errorBackground); border-left: 3px solid var(--vscode-errorForeground); gap: 12px; }
        .danger-title { font-weight: bold; color: var(--vscode-errorForeground); font-size: 13px; }

        .health-circle-container { display: flex; flex-direction: column; align-items: center; margin-bottom: 20px; padding: 24px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 12px; border: 1px solid var(--vscode-panel-border); box-shadow: 0 4px 16px rgba(0,0,0,0.05); }
        .health-svg { width: 120px; height: 120px; transform: rotate(-90deg); margin-bottom: 12px; }
        .svg-bg { fill: none; stroke: var(--vscode-editor-background); stroke-width: 8; }
        .svg-progress { fill: none; stroke-width: 8; stroke-linecap: round; transition: stroke-dashoffset 1.5s ease-in-out; }
        .svg-text { font-size: 32px; font-weight: bold; text-anchor: middle; transform: rotate(90deg) translate(0, -120px); transform-origin: center; font-family: var(--vscode-font-family); }
        .health-status-text { font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }

        .health-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px;}
        .health-row-label { flex: 0 0 140px; font-size: 12px; display: flex; align-items: center; gap: 6px; }
        .health-bar-container { flex: 1; height: 8px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px; overflow: hidden; }
        .health-bar-fill { height: 100%; border-radius: 4px; }
        .health-bar-fill.green { background: #10b981; }
        .health-bar-fill.orange { background: #f59e0b; }
        .health-bar-fill.red { background: #f43f5e; }
        .health-row-score { flex: 0 0 40px; font-size: 11px; text-align: right; font-weight: bold; color: var(--vscode-descriptionForeground); }

        .heatmap-container { margin: 24px 0; }
        .heatmap-title { font-size: 10px; color: var(--vscode-descriptionForeground); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; }
        .heatmap { display: grid; grid-template-columns: repeat(15, 1fr); gap: 2px; }
        .heatmap-square { aspect-ratio: 1; border-radius: 2px; cursor: help; }
        .heatmap-square.heat-0 { background: var(--vscode-editor-inactiveSelectionBackground); }
        .heatmap-square.heat-1 { background: var(--accent); opacity: 0.4; }
        .heatmap-square.heat-2 { background: var(--accent); opacity: 0.7; }
        .heatmap-square.heat-3 { background: var(--accent); opacity: 1; }

        .timeline-container { border-left: 1px dashed var(--vscode-descriptionForeground); padding-left: 16px; margin-left: 8px; }
        .timeline-item { position: relative; padding-bottom: 16px; }
        .timeline-item:last-child { padding-bottom: 0; }
        .timeline-marker { position: absolute; left: -21px; top: 4px; width: 8px; height: 8px; background: var(--vscode-descriptionForeground); border-radius: 50%; }
        .timeline-item-latest .timeline-marker { background: var(--vscode-textLink-foreground); box-shadow: 0 0 0 2px var(--vscode-editor-background), 0 0 0 4px var(--vscode-textLink-foreground); }
        .commit-msg { font-size: 13px; font-weight: 500; }
        .commit-meta { font-size: 11px; color: var(--vscode-descriptionForeground); font-family: monospace; }
        
        .standup-toggles { display: flex; gap: 8px; margin-bottom: 8px; }
        .standup-toggle { flex: 1; padding: 4px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .standup-toggle.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        textarea { width: 100%; height: 80px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 10px; font-family: monospace; font-size: 12px; resize: vertical; margin-bottom: 12px; box-sizing: border-box; }

        .btn-primary, .btn-secondary {
            width: 100%; padding: 10px; border: none; border-radius: 8px; font-size: 13px; font-weight: bold; cursor: pointer;
            display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            position: relative; overflow: hidden;
        }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,0.15); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); transform: translateY(-1px); }
        
        .btn-spinner { display: inline-block; animation: spin 1s linear infinite; font-weight: bold; font-size: 14px; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .btn-success { background: #10b981 !important; color: white !important; }

        .commit-actions { display: flex; gap: 8px; margin-top: 8px; }
        .commit-actions > button { flex: 1; }

        .merge-banner { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 8px; padding: 12px; margin-bottom: 16px; color: var(--vscode-inputValidation-errorForeground); font-size: 12px; font-weight: bold; }
        .conflict-card { background: var(--vscode-editor-inactiveSelectionBackground); border-left: 3px solid var(--vscode-errorForeground); border-radius: 8px; padding: 12px; margin-bottom: 16px; }
        .conflict-header { font-weight: bold; margin-bottom: 8px; font-size: 12px; }
        .conflict-split { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
        .conflict-side { flex: 1; overflow: hidden; border-radius: 4px; border: 1px solid var(--vscode-panel-border); }
        .conflict-side-header { font-size: 10px; font-weight: bold; padding: 4px 8px; }
        .conflict-side-header.green { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
        .conflict-side-header.blue { background: var(--vscode-textLink-foreground); color: var(--vscode-editor-background); }
        .conflict-code { margin: 0; padding: 8px; font-size: 11px; max-height: 120px; overflow-y: auto; background: var(--vscode-textCodeBlock-background); }
        .conflict-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .conflict-btn { padding: 6px 10px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; transition: opacity 0.2s; }
        .conflict-btn:hover { opacity: 0.8; }
        .conflict-btn.ours { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
        .conflict-btn.theirs { background: var(--vscode-textLink-foreground); color: var(--vscode-editor-background); }
        .conflict-btn.ai { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .conflict-btn.ai-use { background: var(--accent); color: var(--accent-fg); }

        .commit-files-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
        .commit-file-badge { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); padding: 2px 6px; border-radius: 4px; font-size: 10px; opacity: 0.8; }

        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
    </style>
</head>
<body>
    <div class="tab-bar">
        <div class="tab active" onclick="switchTab('overview', 0)">
            <div class="tab-icon"><i class="ph ph-squares-four"></i></div>Overview
        </div>
        <div class="tab" onclick="switchTab('health', 1)">
            <div class="tab-icon"><i class="ph ph-heartbeat"></i></div>Health
        </div>
        <div class="tab" onclick="switchTab('standup', 2)">
            <div class="tab-icon"><i class="ph ph-clipboard-text"></i></div>Standup
        </div>
        <div class="tab" onclick="switchTab('commit', 3)">
            <div class="tab-icon"><i class="ph ph-git-commit"></i></div>Commit
        </div>
        <div class="tab-indicator" id="tab-indicator" style="left: 0%;"></div>
    </div>

    <div class="container">
        <!-- Overview Tab -->
        <div id="tab-overview" class="tab-content active animate-on-scroll visible">
            <div class="header">
                <div class="header-top">
                    <div class="title"><i class="ph ph-brain"></i> Project Memory AI</div>
                    <div class="badge ${badgeColorClass}">${git.daysSinceLastCommit} days away</div>
                </div>
                <div class="header-bottom">
                    <span><i class="ph ph-git-branch"></i> ${git.branch}</span>
                    <span>•</span>
                    <span>Last: ${lastActiveDate}</span>
                </div>
            </div>

            <div class="stats">
                <div class="stat-box">
                    <div class="stat-value">${git.daysSinceLastCommit}</div>
                    <div class="stat-label">Days Away</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value">${git.filesChangedLastSession.length}</div>
                    <div class="stat-label">Files Changed</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value">${git.recentCommits.length}</div>
                    <div class="stat-label">Commits</div>
                </div>
            </div>

            <div class="accordion">
                <div class="accordion-header" onclick="toggleAccordion('summary')">
                    <span>What you were doing</span>
                    <span class="chevron open" id="chev-summary"><i class="ph ph-caret-down"></i></span>
                </div>
                <div class="accordion-content open" id="acc-summary">
                    <div class="ai-card">
                        <p>${displayAi.paragraph.replace(/\n/g, '<br>')}</p>
                        ${suggestionsHtml ? `<ul class="suggestions-list">${suggestionsHtml}</ul>` : ''}
                    </div>
                </div>
            </div>

            <div class="accordion">
                <div class="accordion-header" onclick="toggleAccordion('files')">
                    <span>Recent Files (${git.filesChangedLastSession.length})</span>
                    <span class="chevron open" id="chev-files"><i class="ph ph-caret-down"></i></span>
                </div>
                <div class="accordion-content open" id="acc-files">
                    ${filesHtml}
                </div>
            </div>
        </div>

        <!-- Health Tab -->
        <div id="tab-health" class="tab-content animate-on-scroll">
            ${healthHtml}
            
            <div class="heatmap-container">
                <div class="heatmap-title">ACTIVITY — LAST 30 DAYS</div>
                <div class="heatmap">
                    ${heatmapHtml}
                </div>
            </div>

            ${dangerZonesSection}

            <div class="accordion">
                <div class="accordion-header" onclick="toggleAccordion('todos')">
                    <span>Todos (${git.todos.length})</span>
                    <span class="chevron open" id="chev-todos"><i class="ph ph-caret-down"></i></span>
                </div>
                <div class="accordion-content open" id="acc-todos">
                    ${todosHtml}
                </div>
            </div>
        </div>

        <!-- Standup Tab -->
        <div id="tab-standup" class="tab-content animate-on-scroll">
            <div class="standup-card">
                <h2><i class="ph ph-clipboard-text"></i> DAILY STANDUP</h2>
                <div class="standup-toggles">
                    <button id="toggle-slack" class="standup-toggle active" onclick="setStandupFormat('slack')">Slack</button>
                    <button id="toggle-plain" class="standup-toggle" onclick="setStandupFormat('plain')">Plain</button>
                </div>
                <textarea id="standup-text" readonly placeholder="Click Generate Standup to create your daily update..."></textarea>
                <div class="commit-actions">
                    <button class="btn-primary" onclick="generateStandup(this)">
                        <span class="btn-icon"><i class="ph ph-magic-wand"></i></span>
                        <span class="btn-text">Generate</span>
                        <span class="btn-spinner" style="display:none;"><i class="ph ph-spinner-gap"></i></span>
                    </button>
                    <button class="btn-secondary copy-btn" onclick="copyText(this, 'standup-text')">
                        <span class="btn-icon"><i class="ph ph-copy"></i></span>
                        <span class="btn-text">Copy</span>
                    </button>
                </div>
            </div>

            <div class="accordion" style="margin-top:20px;">
                <div class="accordion-header" onclick="toggleAccordion('timeline')">
                    <span>Git Timeline (${git.recentCommits.length})</span>
                    <span class="chevron open" id="chev-timeline"><i class="ph ph-caret-down"></i></span>
                </div>
                <div class="accordion-content open" id="acc-timeline">
                    <div class="timeline-container">
                        ${commitsHtml}
                    </div>
                </div>
            </div>
        </div>

        <!-- Commit Tab -->
        <div id="tab-commit" class="tab-content animate-on-scroll">
            ${mergeConflictsHtml}
            ${commitHelperHtml}
        </div>
    </div>

    <!-- Prism.js core -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-typescript.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-javascript.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-python.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-css.min.js"></script>

    <script>
        const vscode = acquireVsCodeApi();
        
        let currentTab = 'overview';
        
        const observerOptions = { root: null, threshold: 0.1, rootMargin: "0px" };
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    obs.unobserve(entry.target);
                }
            });
        }, observerOptions);

        document.querySelectorAll('.animate-on-scroll, .animate-item').forEach(el => {
            observer.observe(el);
        });

        function switchTab(tabId, index) {
            currentTab = tabId;
            document.querySelectorAll('.tab').forEach((t, i) => {
                if(i === index) t.classList.add('active');
                else t.classList.remove('active');
            });
            document.querySelectorAll('.tab-content').forEach(tc => {
                tc.classList.remove('active');
                tc.classList.remove('visible');
            });
            
            const content = document.getElementById('tab-' + tabId);
            content.classList.add('active');
            
            setTimeout(() => {
                content.classList.add('visible');
                content.querySelectorAll('.animate-on-scroll, .animate-item').forEach(el => {
                    el.classList.add('visible');
                });
            }, 10);
            
            document.getElementById('tab-indicator').style.left = (index * 25) + '%';
        }

        function toggleAccordion(id) {
            const content = document.getElementById('acc-' + id);
            const chev = document.getElementById('chev-' + id);
            if (content.classList.contains('open')) {
                content.classList.remove('open');
                chev.classList.remove('open');
            } else {
                content.classList.add('open');
                chev.classList.add('open');
            }
        }

        function animateHealthScore(targetScore) {
            const circle = document.getElementById('health-circle-svg');
            const text = document.getElementById('health-score-text');
            if (!circle || !text) return;
            
            const circumference = 339.292;
            circle.style.strokeDasharray = circumference;
            circle.style.strokeDashoffset = circumference;
            
            setTimeout(() => {
                const offset = circumference - (targetScore / 100) * circumference;
                circle.style.strokeDashoffset = offset;
                
                let current = 0;
                const interval = setInterval(() => {
                    current += Math.max(1, Math.floor(targetScore / 20));
                    if (current >= targetScore) {
                        current = targetScore;
                        clearInterval(interval);
                    }
                    text.textContent = current;
                }, 1500 / 20);
            }, 100);
        }
        
        ${healthScoreValue > 0 ? `animateHealthScore(${healthScoreValue});` : ''}

        Prism.highlightAll();

        function copyText(btnElement, targetId) {
            const input = document.getElementById(targetId);
            if (input && input.value) {
                vscode.postMessage({ command: 'copyCommit', text: input.value });
                triggerCopyMorph(btnElement);
            }
        }

        function triggerCopyMorph(btnElement) {
            const iconSpan = btnElement.querySelector('.btn-icon');
            const textSpan = btnElement.querySelector('.btn-text');
            
            btnElement.classList.add('btn-success');
            if(iconSpan) iconSpan.innerHTML = '<i class="ph ph-check-circle"></i>';
            if(textSpan) textSpan.textContent = 'Copied!';
            
            setTimeout(() => {
                btnElement.classList.remove('btn-success');
                if(iconSpan) iconSpan.innerHTML = '<i class="ph ph-copy"></i>';
                if(textSpan) textSpan.textContent = 'Copy';
            }, 2000);
        }

        function generateCommit(btnElement) {
            setButtonLoading(btnElement, true);
            vscode.postMessage({ command: 'generateCommit' });
        }

        function generateStandup(btnElement) {
            setButtonLoading(btnElement, true);
            vscode.postMessage({ command: 'generateStandup' });
        }

        function setButtonLoading(btnElement, isLoading) {
            const icon = btnElement.querySelector('.btn-icon');
            const spinner = btnElement.querySelector('.btn-spinner');
            btnElement.disabled = isLoading;
            if (isLoading) {
                if(icon) icon.style.display = 'none';
                if(spinner) spinner.style.display = 'inline-block';
            } else {
                if(icon) icon.style.display = 'inline-block';
                if(spinner) spinner.style.display = 'none';
            }
        }

        let currentStandupSlack = '';
        let currentStandupPlain = '';
        let currentFormat = 'slack';

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'commitGenerated') {
                const input = document.getElementById('commit-msg-input');
                if (input) input.value = message.text;
                
                document.querySelectorAll('.commit-btn.btn-primary').forEach(btn => {
                    if (btn.querySelector('.btn-spinner')?.style.display !== 'none') {
                        setButtonLoading(btn, false);
                    }
                });
            } else if (message.command === 'standupGenerated') {
                currentStandupSlack = message.slack;
                currentStandupPlain = message.plain;
                updateStandupText();
                
                document.querySelectorAll('.btn-primary').forEach(btn => {
                    if (btn.querySelector('.btn-spinner')?.style.display !== 'none') {
                        setButtonLoading(btn, false);
                    }
                });
            } else if (message.command === 'conflictAnalyzed') {
                const recDiv = document.getElementById('conflict-rec-' + message.index);
                if (recDiv) {
                    recDiv.style.display = 'block';
                    let badgeClass = 'manual';
                    let text = 'MANUAL';
                    if (message.recommendation === 'ours') { badgeClass = 'ours'; text = 'ACCEPT OURS'; }
                    if (message.recommendation === 'theirs') { badgeClass = 'theirs'; text = 'ACCEPT THEIRS'; }
                    
                    recDiv.innerHTML = \`<div class="rec-badge \${badgeClass}">\${text}</div><div style="color: var(--vscode-descriptionForeground)">\${message.explanation}</div>\`;
                }

                const aiUseBtn = document.getElementById('use-ai-' + message.index);
                if (aiUseBtn) aiUseBtn.style.display = 'inline-block';

                const cards = document.querySelectorAll('.conflict-card');
                const analyzeBtn = cards[message.index]?.querySelector('.conflict-btn.ai');
                if (analyzeBtn) {
                    analyzeBtn.textContent = 'Analyze with AI';
                    analyzeBtn.disabled = false;
                }
            } else if (message.command === 'conflictResolved') {
                const card = document.getElementById('conflict-' + message.index);
                if (card) card.style.display = 'none';
            } else if (message.command === 'allConflictsResolved') {
                const btn = document.getElementById('resolve-all-btn');
                if (btn) {
                    setButtonLoading(btn, false);
                    btn.classList.add('btn-success');
                    btn.querySelector('.btn-text').textContent = 'All conflicts resolved!';
                }
            } else if (message.command === 'resolvingAllProgress') {
                const btn = document.getElementById('resolve-all-btn');
                if (btn) {
                    btn.querySelector('.btn-text').textContent = message.text;
                }
            }
        });

        function updateStandupText() {
            const textarea = document.getElementById('standup-text');
            if (textarea) {
                textarea.value = currentFormat === 'slack' ? currentStandupSlack : currentStandupPlain;
            }
        }

        function setStandupFormat(format) {
            currentFormat = format;
            document.getElementById('toggle-slack').classList.toggle('active', format === 'slack');
            document.getElementById('toggle-plain').classList.toggle('active', format === 'plain');
            updateStandupText();
        }

        function openFile(file) { vscode.postMessage({ command: 'openFile', file }); }
        function openTodo(file, line) { vscode.postMessage({ command: 'openTodo', file, line }); }
        function resolveConflict(index, action) { vscode.postMessage({ command: 'resolveConflict', index, action }); }
        
        function analyzeConflict(btn, index) {
            btn.textContent = 'Analyzing...';
            btn.disabled = true;
            vscode.postMessage({ command: 'analyzeConflict', index });
        }
        function resolveAllConflicts(btn) {
            setButtonLoading(btn, true);
            vscode.postMessage({ command: 'resolveAllConflicts' });
        }
    </script>
</body>
</html>`;
    }

    private _getLoadingHtml() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <style>
        body { 
            font-family: var(--vscode-font-family); 
            padding: 0; margin: 0;
            background-color: var(--vscode-editor-background);
            overflow: hidden;
        }
        
        .tab-bar {
            position: fixed; top: 0; left: 0; width: 100%; display: flex;
            background: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            height: 60px;
        }
        
        .container { padding: 16px; padding-top: 76px; }

        .skeleton {
            background: linear-gradient(90deg, 
                var(--vscode-editor-background) 25%, 
                var(--vscode-editor-inactiveSelectionBackground) 50%, 
                var(--vscode-editor-background) 75%);
            background-size: 400px 100%;
            border-radius: 8px;
            animation: shimmer 1.5s infinite linear;
        }

        @keyframes shimmer {
            0% { background-position: -200px 0; }
            100% { background-position: 200px 0; }
        }

        .skel-header { height: 90px; margin-bottom: 24px; }
        
        .skel-stats { 
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; 
        }
        .skel-stat { height: 80px; }
        
        .skel-accordion { height: 40px; margin-bottom: 16px; }
        .skel-card { height: 160px; margin-bottom: 24px; }
        
        .skel-list-item { height: 44px; margin-bottom: 8px; }

    </style>
</head>
<body>
    <div class="tab-bar"></div>
    <div class="container">
        <div class="skeleton skel-header"></div>
        
        <div class="skel-stats">
            <div class="skeleton skel-stat"></div>
            <div class="skeleton skel-stat"></div>
            <div class="skeleton skel-stat"></div>
        </div>
        
        <div class="skeleton skel-accordion"></div>
        <div class="skeleton skel-card"></div>
        
        <div class="skeleton skel-accordion"></div>
        <div class="skeleton skel-list-item"></div>
        <div class="skeleton skel-list-item"></div>
        <div class="skeleton skel-list-item"></div>
        <div class="skeleton skel-list-item"></div>
    </div>
</body>
</html>`;
    }
    private _getErrorHtml(message: string) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <style>
        body { 
            font-family: var(--vscode-font-family); 
            color: var(--vscode-errorForeground); 
            padding: 20px; 
            text-align: center;
        }
        .error-icon {
            font-size: 32px;
            margin-bottom: 16px;
        }
        .btn {
            background: var(--vscode-button-background); 
            color: var(--vscode-button-foreground); 
            border: none; 
            padding: 8px 16px; 
            cursor: pointer;
            border-radius: 6px;
            margin-top: 16px;
        }
    </style>
</head>
<body>
    <div class="error-icon">⚠️</div>
    <h3>Error loading Project Memory</h3>
    <p>${message}</p>
    <button class="btn" onclick="acquireVsCodeApi().postMessage({ command: 'refresh' })">Try Again</button>
</body>
</html>`;
    }
}
