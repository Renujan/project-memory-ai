import * as vscode from 'vscode';
import { AISummarizer } from './aiSummarizer';
import * as fs from 'fs/promises';

export interface MergeConflict {
    file: string;
    index: number;
    ourCode: string;
    theirCode: string;
    startLine: number;
    endLine: number;
    fullBlock: string;
}

export interface MergeResolution {
    conflict: MergeConflict;
    recommendation: 'ours' | 'theirs' | 'manual';
    explanation: string;
    mergedCode: string;
}

/**
 * MergeResolver class to detect and resolve git merge conflicts using AI.
 */
export class MergeResolver {
    private aiSummarizer: AISummarizer;

    /**
     * Creates an instance of MergeResolver.
     * @param {AISummarizer} aiSummarizer - The AI summarizer instance.
     */
    constructor(aiSummarizer: AISummarizer) {
        this.aiSummarizer = aiSummarizer;
    }

    /**
     * Detects merge conflicts in the workspace.
     * @returns {Promise<MergeConflict[]>} Array of detected conflicts.
     */
    public async detectConflicts(): Promise<MergeConflict[]> {
        const conflicts: MergeConflict[] = [];
        let conflictIndex = 0;

        const filesToScan = new Map<string, vscode.Uri>();

        // 1. Open documents
        for (const doc of vscode.workspace.textDocuments) {
            filesToScan.set(doc.uri.fsPath, doc.uri);
        }

        // 2. All files in workspace (exclude node_modules, .git, etc.)
        const uris = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/*.pyc,**/__pycache__/**}');
        for (const uri of uris) {
            if (!filesToScan.has(uri.fsPath)) {
                filesToScan.set(uri.fsPath, uri);
            }
        }

        for (const fsPath of filesToScan.keys()) {
            try {
                let content = '';
                const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === fsPath);
                if (openDoc) {
                    content = openDoc.getText();
                } else {
                    const data = await fs.readFile(fsPath, 'utf8');
                    content = data;
                }

                if (!content.includes('<<<<<<<')) {
                    continue;
                }

                const lines = content.split(/\r?\n/);
                let inConflict = false;
                let ourCodeLines: string[] = [];
                let theirCodeLines: string[] = [];
                let fullBlockLines: string[] = [];
                let startLine = 0;
                let isOurs = false;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    if (line.startsWith('<<<<<<<')) {
                        inConflict = true;
                        isOurs = true;
                        startLine = i;
                        fullBlockLines = [line];
                        ourCodeLines = [];
                        theirCodeLines = [];
                        continue;
                    }

                    if (inConflict) {
                        fullBlockLines.push(line);

                        if (line.startsWith('=======')) {
                            isOurs = false;
                        } else if (line.startsWith('>>>>>>>')) {
                            inConflict = false;
                            conflicts.push({
                                file: fsPath,
                                index: conflictIndex++,
                                ourCode: ourCodeLines.join('\n'),
                                theirCode: theirCodeLines.join('\n'),
                                startLine,
                                endLine: i,
                                fullBlock: fullBlockLines.join('\n')
                            });
                        } else {
                            if (isOurs) {
                                ourCodeLines.push(line);
                            } else {
                                theirCodeLines.push(line);
                            }
                        }
                    }
                }
            } catch (error) {
                // Ignore binary files or read errors
            }
        }

        return conflicts;
    }

    /**
     * Resolves a single conflict using AI.
     * @param {MergeConflict} conflict - The conflict to resolve.
     * @returns {Promise<MergeResolution>} The resolution recommendation.
     */
    public async resolveConflict(conflict: MergeConflict): Promise<MergeResolution> {
        const prompt = `You are an expert code reviewer helping resolve a git merge conflict. Analyze both versions and recommend which to keep.
Our version (HEAD):
${conflict.ourCode}

Incoming version:
${conflict.theirCode}

Respond in exactly this format:
RECOMMENDATION: ours OR theirs OR manual
EXPLANATION: [2 sentences max explaining why].
MERGED: [if manual, provide the best combined version, otherwise repeat the recommended version].

Be specific about what each version does differently.`;

        const systemMsg = "You are an expert code reviewer.";
        const response = await this.aiSummarizer.askAI(prompt, systemMsg);

        let recommendation: 'ours' | 'theirs' | 'manual' = 'manual';
        let explanation = '';
        let mergedCode = '';

        const recMatch = response.match(/RECOMMENDATION:\s*(ours|theirs|manual)/i);
        if (recMatch) {
            recommendation = recMatch[1].toLowerCase() as 'ours' | 'theirs' | 'manual';
        }

        const expMatch = response.match(/EXPLANATION:\s*([\s\S]*?)(?:MERGED:|$)/i);
        if (expMatch) {
            explanation = expMatch[1].trim();
        }

        const mergedMatch = response.match(/MERGED:\s*([\s\S]*)$/i);
        if (mergedMatch) {
            mergedCode = mergedMatch[1].trim();
        }

        // Fallback to recommended code if merged is somehow empty
        if (!mergedCode) {
            mergedCode = recommendation === 'ours' ? conflict.ourCode : conflict.theirCode;
        }

        return {
            conflict,
            recommendation,
            explanation,
            mergedCode
        };
    }

    /**
     * Applies the resolved code to the file.
     * @param {MergeResolution} resolution - The resolution to apply.
     */
    public async applyResolution(resolution: MergeResolution): Promise<void> {
        const uri = vscode.Uri.file(resolution.conflict.file);
        const edit = new vscode.WorkspaceEdit();

        const range = new vscode.Range(
            new vscode.Position(resolution.conflict.startLine, 0),
            new vscode.Position(resolution.conflict.endLine, resolution.conflict.fullBlock.split('\n').pop()?.length || 0)
        );

        // Replace the entire conflict block with the merged code
        edit.replace(uri, range, resolution.mergedCode);
        
        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            vscode.window.showInformationMessage(`Conflict resolved in ${vscode.workspace.asRelativePath(resolution.conflict.file)}`);
        } else {
            throw new Error(`Failed to apply edit to ${resolution.conflict.file}`);
        }
    }

    /**
     * Resolves all detected conflicts in the workspace using AI.
     * @returns {Promise<MergeResolution[]>} Array of resolutions.
     */
    public async resolveAllConflicts(): Promise<MergeResolution[]> {
        const conflicts = await this.detectConflicts();
        const resolutions: MergeResolution[] = [];

        for (const conflict of conflicts) {
            const resolution = await this.resolveConflict(conflict);
            resolutions.push(resolution);
            await this.applyResolution(resolution);
        }

        return resolutions;
    }
}
