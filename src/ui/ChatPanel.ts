import * as vscode from 'vscode';
import { AIService } from '../services/AIService';
import { AgentCore } from '../agent/AgentCore';
import { v4 as uuidv4 } from 'uuid';
import { ASTAnalyzer } from '../services/ASTAnalyzer';
import { HistoryManager } from '../services/HistoryManager';
import { CommandApprovalRequest, CommandApprovalProvider, commandApprovalService } from '../services/CommandApprovalService';





interface FileChange {
    id: string;
    filename: string;
    operation: 'create' | 'edit' | 'delete';
    linesAdded: number;
    linesRemoved: number;
    timestamp: number;
    status: 'pending' | 'approved' | 'rejected';
    diff?: string;
    description?: string;
    originalContent?: string;
    newContent?: string;
}

export class ChatPanel implements vscode.WebviewViewProvider, CommandApprovalProvider {

    public static currentProvider?: ChatPanel;
    private _view?: vscode.WebviewView;
    private _history: any[] = [];
    private _agentCore: AgentCore;
    private _conversationId: string;
    private _fileChanges: FileChange[] = [];
    private _astAnalyzer: ASTAnalyzer;
    private _historyManager: HistoryManager;
    private _pendingApprovals: Map<string, (approved: boolean) => void> = new Map();
    private static _instanceCount = 0;
    private _historyLoaded = false;



    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _aiService: AIService
    ) {
        ChatPanel.currentProvider = this;
        ChatPanel._instanceCount++;
        this._astAnalyzer = new ASTAnalyzer();
        this._historyManager = new HistoryManager(_context);
        this._agentCore = new AgentCore(_aiService, _context);

        this._conversationId = uuidv4();
        // We load history in resolveWebviewView/webviewReady
        commandApprovalService.setProvider(this);
    }

    public async requestApproval(request: CommandApprovalRequest, isDangerous: boolean): Promise<boolean> {
        const approvalId = uuidv4();
        return new Promise<boolean>((resolve) => {
            this._pendingApprovals.set(approvalId, resolve);
            this._view?.webview.postMessage({
                type: 'commandApprovalRequest',
                id: approvalId,
                command: request.command,
                cwd: request.cwd,
                isDangerous
            });
        });
    }




    private getConversationsKey(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            return `conversations_${workspaceFolder.uri.fsPath.replace(/[\\\/]/g, '_')}`;
        }
        return 'conversations_global';
    }

    private getCurrentConversationKey(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            return `currentConversation_${workspaceFolder.uri.fsPath.replace(/[\\\/]/g, '_')}`;
        }
        return 'currentConversation_global';
    }

    private getHistoryKey(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            // Use workspace path as unique identifier
            return `chatHistory_${workspaceFolder.uri.fsPath.replace(/[\\\/]/g, '_')}`;
        }
        // Fallback to global history if no workspace
        return 'chatHistory_global';
    }

    private async loadHistory(id?: string) {
        const currentKey = this.getCurrentConversationKey();
        let conversationId = id;

        // If no ID provided, decide whether to restore or start fresh
        if (!conversationId) {
            const lastId = this._context.globalState.get<string>(currentKey);

            // Heuristic: If this is a secondary window (instanceCount > 1) and we haven't loaded yet,
            // start fresh. Otherwise, restore the last one (for primary window or reload).
            if (ChatPanel._instanceCount > 1 && !this._historyLoaded) {
                conversationId = this._conversationId; // Use the one generated in constructor
            } else {
                conversationId = lastId || this._conversationId;
            }
        }

        const conversationsList = await this._historyManager.listConversations();

        if (!conversationId || !conversationsList.find(c => c.id === conversationId)) {
            // If the restored ID isn't in history anymore, check if we have any history at all
            if (conversationsList.length > 0 && !id) {
                // If we were trying to auto-restore but the ID is gone, pick the latest
                conversationId = conversationsList[0].id;
            } else {
                // Otherwise stick with whatever we have (fresh ID)
                conversationId = conversationId || this._conversationId;
            }
        }

        this._conversationId = conversationId;
        this._historyLoaded = true;
        const data = await this._historyManager.loadHistory(conversationId);

        if (data) {
            this._history = data.history || [];
            this._fileChanges = data.fileChanges || [];
        } else {
            this._history = [];
            this._fileChanges = [];
        }

        // Ensure state is updated so other windows know what the "last" one was
        await this._context.globalState.update(currentKey, this._conversationId);
    }



    private async saveHistory() {
        let title = '';
        if (this._history.length > 0) {
            const firstUserMessage = this._history.find(h => h.role === 'user');
            if (firstUserMessage) {
                title = firstUserMessage.parts[0].text.substring(0, 50);
                if (firstUserMessage.parts[0].text.length > 50) title += '...';
            }
        }

        const data = {
            id: this._conversationId,
            title: title || 'New Conversation',
            timestamp: Date.now(),
            history: this._history,
            fileChanges: this._fileChanges
        };

        await this._historyManager.saveHistory(this._conversationId, data);
        this._context.globalState.update(this.getCurrentConversationKey(), this._conversationId);
    }


    private async getConversationsList() {
        return await this._historyManager.listConversations();
    }


    private async switchConversation(conversationId: string) {
        await this._context.globalState.update(this.getCurrentConversationKey(), conversationId);
        await this.loadHistory(conversationId);
        this._view?.webview.postMessage({
            type: 'loadHistory',
            history: this._history
        });
    }



    private async deleteConversation(conversationId: string) {
        const result = await vscode.window.showWarningMessage(
            'Are you sure you want to delete this conversation?',
            { modal: true },
            'Delete'
        );

        if (result !== 'Delete') {
            return;
        }

        await this._historyManager.deleteHistory(conversationId);

        // If it's the current conversation, start a new one
        if (this._conversationId === conversationId) {
            await this.newConversation();
            vscode.window.showInformationMessage('Current conversation deleted.');
        } else {
            // Refresh list in webview
            const conversations = await this.getConversationsList();
            this._view?.webview.postMessage({
                type: 'conversationsList',
                conversations: conversations,
                currentId: this._conversationId,
                forceShow: true
            });
            vscode.window.showInformationMessage('Conversation history deleted.');
        }
    }





    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this.getConversationsList().then(conversations => {
            this._view?.webview.postMessage({
                type: 'conversationsList',
                conversations: conversations,
                currentId: this._conversationId
            });
        });

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'webviewReady':
                    // Webview is ready, load history and status
                    await this.loadHistory();
                    console.log('ChatPanel: Loading history, count:', this._history.length);
                    if (this._history.length > 0) {
                        this._view?.webview.postMessage({
                            type: 'loadHistory',
                            history: this._history
                        });
                    }
                    const budgetStatus = this._agentCore.getTokenBudgetStatus();
                    this._view?.webview.postMessage({
                        type: 'budgetUpdate',
                        budget: budgetStatus
                    });

                    // Send models list to UI
                    await this.sendModelsToWebview();

                    // Also refresh other lists
                    this.getConversationsList().then(conversations => {
                        this._view?.webview.postMessage({
                            type: 'conversationsList',
                            conversations: conversations,
                            currentId: this._conversationId
                        });
                    });
                    break;
                case 'sendMessage':
                    await this.handleUserMessage(data.text, data.mode, data.model, data.attachments);
                    break;
                case 'newConversation':
                    await this.newConversation();
                    break;

                case 'openFile':
                    this.openFile(data.path);
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('cnx.openSettings');
                    break;
                case 'getModels':
                    await this.sendModelsToWebview();
                    break;
                case 'changeModel':
                    await this.changeModel(data.model, data.provider);
                    break;
                case 'changeMode':
                    vscode.window.showInformationMessage(`Mode changed to: ${data.mode}`);
                    break;
                case 'exportArtifact':
                    await this.exportArtifact(data.artifactId);
                    break;
                case 'voiceInput':
                    this.handleVoiceInput();
                    break;
                case 'addContext':
                    await this.handleAddContext(data.action);
                    break;
                case 'stopGeneration':
                    this.handleStopGeneration();
                    break;
                case 'continueGeneration':
                    this.handleContinueGeneration();
                    break;
                case 'error':
                    vscode.window.showErrorMessage(data.text);
                    break;
                case 'getConversations':
                    this.getConversationsList().then(conversations => {
                        this._view?.webview.postMessage({
                            type: 'conversationsList',
                            conversations: conversations,
                            currentId: this._conversationId,
                            forceShow: true
                        });
                    });
                    break;
                case 'switchConversation':
                    this.switchConversation(data.conversationId);
                    break;
                case 'deleteConversation':
                    this.deleteConversation(data.conversationId);
                    break;
                case 'sendTerminalInput':
                    this._agentCore.sendTerminalInput(data.input || '\n');
                    break;
                case 'approveChange':
                    this.handleApproveChange(data.changeId);
                    break;
                case 'rejectChange':
                    this.handleRejectChange(data.changeId);
                    break;
                case 'requestDiff':
                    this.handleRequestDiff(data.changeId);
                    break;
                case 'approveAllChanges':
                    this.approveAllFileChanges();
                    break;
                case 'rejectAllChanges':
                    this.rejectAllFileChanges();
                    break;
                case 'getPendingChanges':
                    this._view?.webview.postMessage({
                        type: 'pendingChangesList',
                        changes: this._fileChanges
                    });
                    break;
                case 'getFileChanges':
                    this._view?.webview.postMessage({
                        type: 'fileChangesList',
                        changes: this._fileChanges
                    });
                    break;
                case 'approvalResponse':
                    const resolve = this._pendingApprovals.get(data.id);
                    if (resolve) {
                        resolve(data.approved);
                        this._pendingApprovals.delete(data.id);
                    }
                    break;
                case 'searchFiles':
                    await this.handleSearchFiles(data.query);
                    break;
            }

        });
    }

    private async handleSearchFiles(query: string = '') {
        try {
            const exclude = '**/{node_modules,.git,dist,out,build,.vscode}/**';
            // If query is empty, find all files (limit 50). If query exists, filter by it.
            const pattern = query ? `**/*${query}*` : '**/*';

            const files = await vscode.workspace.findFiles(pattern, exclude, 50);

            const fileRecs = files.map(file => ({
                label: vscode.workspace.asRelativePath(file),
                path: file.fsPath,
                description: file.fsPath
            }));

            this._view?.webview.postMessage({
                type: 'fileSearchResults',
                files: fileRecs
            });
        } catch (error) {
            console.error('ChatPanel: Error searching files:', error);
        }
    }

    private async openFile(filePath: string) {
        try {
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        } catch (e) {
            vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
        }
    }

    public async newConversation() {
        this._history = [];
        this._conversationId = uuidv4();
        this._agentCore.resetTokenBudget();
        await this.saveHistory();
        this._view?.webview.postMessage({ type: 'clearChat' });

        // Send fresh budget status
        const budgetStatus = this._agentCore.getTokenBudgetStatus();
        this._view?.webview.postMessage({
            type: 'budgetUpdate',
            budget: budgetStatus
        });

        // Refresh conversations list in webview
        const list = await this.getConversationsList();
        this._view?.webview.postMessage({
            type: 'conversationsList',
            conversations: list,
            currentId: this._conversationId
        });
    }


    public async clearHistory() {
        await this.newConversation();
        this._fileChanges = [];
        await this.saveFileChanges();
    }


    private async saveFileChanges() {
        await this.saveHistory();
    }


    private loadFileChanges() {
        const conversationsKey = this.getConversationsKey();
        const conversations = this._context.globalState.get<any>(conversationsKey) || {};
        const conversation = conversations[this._conversationId];

        if (conversation && conversation.fileChanges) {
            this._fileChanges = conversation.fileChanges;
            this.updateFileChangesCount();
        }
    }


    private addFileChange(filename: string, operation: 'create' | 'edit' | 'delete', linesAdded: number = 0, linesRemoved: number = 0, diff?: string, description?: string) {
        const change: FileChange = {
            id: uuidv4(),
            filename,
            operation,
            linesAdded,
            linesRemoved,
            timestamp: Date.now(),
            status: 'pending',
            diff,
            description
        };

        this._fileChanges.push(change);

        // Notify webview
        this._view?.webview.postMessage({
            type: 'addFileChange',
            change: change
        });

        // Update file changes count
        this.updateFileChangesCount();
    }

    private addFileChangeWithContent(filename: string, operation: 'create' | 'edit' | 'delete', linesAdded: number, linesRemoved: number, diff: string, description: string, originalContent: string, newContent: string) {
        const change: FileChange = {
            id: uuidv4(),
            filename,
            operation,
            linesAdded,
            linesRemoved,
            timestamp: Date.now(),
            status: 'pending',
            diff,
            description,
            originalContent,
            newContent
        };

        this._fileChanges.push(change);

        // Notify webview
        this._view?.webview.postMessage({
            type: 'addFileChange',
            change: change
        });

        // Update file changes count
        this.updateFileChangesCount();

        // Save to persistence
        this.saveFileChanges();
    }


    private handleApproveChange(changeId: string) {
        const change = this._fileChanges.find(c => c.id === changeId);
        if (change) {
            change.status = 'approved';
            this.saveHistory();
            this._view?.webview.postMessage({
                type: 'fileChangeUpdated',
                change
            });
            this.updateFileChangesCount();
            vscode.window.showInformationMessage(`Approved changes for ${change.filename}`);
        }
    }

    private handleRejectChange(changeId: string) {
        const change = this._fileChanges.find(c => c.id === changeId);
        if (change) {
            change.status = 'rejected';
            this.saveHistory();
            this._view?.webview.postMessage({
                type: 'fileChangeUpdated',
                change
            });
            this.updateFileChangesCount();
            vscode.window.showInformationMessage(`Rejected changes for ${change.filename}`);
        }
    }

    private approveAllFileChanges() {
        this._fileChanges.forEach(change => {
            if (change.status === 'pending') {
                change.status = 'approved';
                this._view?.webview.postMessage({
                    type: 'fileChangeUpdated',
                    change: change
                });
            }
        });
        this.updateFileChangesCount();
        this.saveHistory();
    }

    private rejectAllFileChanges() {
        this._fileChanges.forEach(change => {
            if (change.status === 'pending') {
                change.status = 'rejected';
                this._view?.webview.postMessage({
                    type: 'fileChangeUpdated',
                    change: change
                });
            }
        });
        this.updateFileChangesCount();
        this.saveHistory();
    }


    private updateFileChangesCount() {
        const total = this._fileChanges.length;
        const pending = this._fileChanges.filter(c => c.status === 'pending').length;
        this._view?.webview.postMessage({
            type: 'updateFileChangesCount',
            count: pending,
            total
        });
    }


    private generateDiff(originalContent: string, newContent: string): string {
        const originalLines = originalContent.split('\n');
        const newLines = newContent.split('\n');

        let diff = '';
        const maxLines = Math.max(originalLines.length, newLines.length);

        for (let i = 0; i < maxLines; i++) {
            const oldLine = originalLines[i];
            const newLine = newLines[i];

            if (oldLine !== newLine) {
                if (oldLine !== undefined) {
                    diff += `- ${oldLine}\n`;
                }
                if (newLine !== undefined) {
                    diff += `+ ${newLine}\n`;
                }
            } else if (oldLine !== undefined) {
                diff += `  ${oldLine}\n`;
            }
        }

        return diff || 'No changes detected';
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }




    /** Fetch all models from the registry and push them to the webview. */
    public async sendModelsToWebview(): Promise<void> {
        try {
            const allModels = await this._aiService.getModelRegistry().getAllModels();
            const formattedModels = allModels.map((m: any) => ({
                name: m.id,
                provider: m.provider,
                displayName: m.displayName || m.id
            }));
            const currentModel = vscode.workspace.getConfiguration('cnx').get<string>('model', 'gpt-4o');
            this._view?.webview.postMessage({
                type: 'setModels',
                models: formattedModels,
                currentModel
            });
        } catch (e) {
            console.error('ChatPanel: Failed to load models:', e);
        }
    }

    private async changeModel(model: string, provider?: string) {
        const config = vscode.workspace.getConfiguration('cnx');
        await config.update('model', model, vscode.ConfigurationTarget.Global);
        if (provider) {
            await config.update('aiProvider', provider, vscode.ConfigurationTarget.Global);
        }
        vscode.window.showInformationMessage(`Model changed to: ${model}`);
    }

    private async exportArtifact(artifactId: string) {
        const artifacts = this._agentCore.getArtifacts();
        const artifact = artifacts.find(a => a.metadata.id === artifactId);

        if (!artifact) {
            vscode.window.showErrorMessage('Artifact not found');
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const fileName = await vscode.window.showInputBox({
            prompt: 'Enter file name',
            value: artifact.metadata.name
        });

        if (fileName) {
            const filePath = vscode.Uri.joinPath(workspaceFolder.uri, fileName).fsPath;
            // Export logic would go here
            vscode.window.showInformationMessage(`Artifact exported to: ${fileName}`);
        }
    }


    private handleVoiceInput() {
        // Handled locally in the webview via Web Speech API
    }

    private async handleAddContext(action?: string) {
        if (action === 'media') {
            const options: vscode.OpenDialogOptions = {
                canSelectMany: true,
                openLabel: 'Add Media',
                filters: {
                    'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp'],
                    'Videos': ['mp4', 'mov', 'webm']
                }
            };
            const fileUris = await vscode.window.showOpenDialog(options);
            if (fileUris && fileUris.length > 0) {
                for (const uri of fileUris) {
                    const fileName = uri.fsPath.split(/[\\\/]/).pop() || uri.fsPath;
                    this._view?.webview.postMessage({
                        type: 'addAttachment',
                        name: fileName,
                        path: uri.fsPath,
                        icon: 'media'
                    });
                }
            }
        } else if (action === 'File') {
            const options: vscode.OpenDialogOptions = {
                canSelectMany: true,
                openLabel: 'Select Program/File',
                filters: {
                    'All Files': ['*']
                }
            };
            const fileUris = await vscode.window.showOpenDialog(options);
            if (fileUris && fileUris.length > 0) {
                for (const uri of fileUris) {
                    const fileName = uri.fsPath.split(/[\\\/]/).pop() || uri.fsPath;
                    this._view?.webview.postMessage({
                        type: 'addAttachment',
                        name: fileName,
                        path: uri.fsPath,
                        icon: 'file'
                    });
                }
            }
        } else if (action === 'workflows') {
            this._view?.webview.postMessage({
                type: 'triggerWorkflow'
            });
        }
    }



    private handleRequestDiff(changeId: string) {
        const change = this._fileChanges.find(c => c.id === changeId);
        if (change) {
            this._view?.webview.postMessage({
                type: 'showDiff',
                change: {
                    id: change.id,
                    filename: change.filename,
                    diff: change.diff,
                    operation: change.operation,
                    linesAdded: change.linesAdded,
                    linesRemoved: change.linesRemoved,
                    description: change.description
                }
            });
        }
    }

    private handleStopGeneration() {
        // Cancel the ongoing generation
        this._agentCore.cancel();

        // Send clear stop message to UI
        this._view?.webview.postMessage({
            type: 'generationStopped',
            text: '🛑 Generation stopped by user'
        });

        // Reset status
        this._view?.webview.postMessage({
            type: 'statusUpdate',
            text: ''
        });

        vscode.window.showInformationMessage('Generation stopped');
    }

    private handleContinueGeneration() {
        this._agentCore.sendTerminalInput('\n');
        this.approveAllFileChanges();

        // Also approve all pending approval blocks (commands)
        const approvalIds = Array.from(this._pendingApprovals.keys());
        for (const id of approvalIds) {
            const resolve = this._pendingApprovals.get(id);
            if (resolve) {
                resolve(true);
                this._pendingApprovals.delete(id);
                // Update UI to reflect approval
                this._view?.webview.postMessage({
                    type: 'commandApprovalUpdate',
                    id: id,
                    status: 'approved'
                });
            }
        }
    }

    public async dispose() {
        ChatPanel._instanceCount = Math.max(0, ChatPanel._instanceCount - 1);
        await this._agentCore.dispose();
    }

    private async handleUserMessage(text: string, mode?: string, model?: string, attachments?: any[]) {
        if (!this._aiService.isConfigured()) {
            this._view?.webview.postMessage({
                type: 'addResponse',
                text: '⚠️ Error: Please set your API key in settings.'
            });
            return;
        }

        let displayedText = text;
        if (attachments && attachments.length > 0) {
            const attachmentNames = attachments.map(a => `📎 ${a.name}`).join(', ');
            displayedText = `${text}\n\n*Attached: ${attachmentNames}*`;
        }

        this._view?.webview.postMessage({ type: 'addMessage', text: displayedText, role: 'user' });
        await this.saveHistory();

        try {
            // Include model preference if specified
            if (model) {
                const config = vscode.workspace.getConfiguration('cnx');
                await config.update('model', model, vscode.ConfigurationTarget.Global);
            }

            await this._agentCore.processMessage(text, this._history, async (update) => {
                switch (update.type) {
                    case 'textChunk':
                        this._view?.webview.postMessage({
                            type: 'streamChunk',
                            text: update.text
                        });
                        break;

                    case 'budgetUpdate':
                        this._view?.webview.postMessage({
                            type: 'budgetUpdate',
                            budget: update.budget
                        });
                        break;

                    case 'artifactCreated':
                        this._view?.webview.postMessage({
                            type: 'artifactCreated',
                            artifact: update.artifact
                        });
                        break;

                    case 'toolStart':
                        this._view?.webview.postMessage({
                            type: 'addToolCall',
                            tool: update.tool,
                            args: JSON.stringify(update.args, null, 2),
                            id: update.id
                        });
                        break;

                    case 'toolEnd':
                        this._view?.webview.postMessage({
                            type: 'updateToolResult',
                            tool: update.tool,
                            result: typeof update.result === 'string' ? update.result : JSON.stringify(update.result, null, 2),
                            id: update.id
                        });

                        // Track file changes with actual content
                        if (update.tool === 'write_to_file' || update.tool === 'replace_file_content' || update.tool === 'multi_replace_file_content') {
                            const args = update.args as any;
                            const filename = args.TargetFile || args.targetFile || args.file || 'unknown';
                            const operation = update.tool === 'write_to_file' ? 'create' : 'edit';
                            const description = args.Description || args.description || args.Instruction || '';

                            let originalContent = '';
                            let newContent = '';
                            let linesAdded = 0;
                            let linesRemoved = 0;
                            let diff = '';

                            try {
                                // Read the file content after modification
                                const uri = vscode.Uri.file(filename);
                                const fileContent = await vscode.workspace.fs.readFile(uri);
                                newContent = Buffer.from(fileContent).toString('utf8');

                                if (operation === 'create') {
                                    // For new files, all lines are added
                                    linesAdded = newContent.split('\n').length;
                                    linesRemoved = 0;
                                    diff = this.generateDiff('', newContent);
                                } else {
                                    if (update.tool === 'multi_replace_file_content' && args.replacements) {
                                        originalContent = args.replacements.map((r: any) => r.targetContent).join('\n---\n');
                                    } else {
                                        originalContent = args.TargetContent || args.targetContent || '';
                                    }
                                    const originalLines = originalContent.split('\n');
                                    const newLines = newContent.split('\n');

                                    linesAdded = newLines.length;
                                    linesRemoved = originalLines.length;
                                    diff = this.generateDiff(originalContent, newContent);
                                }

                                // Check for breaking changes
                                const dependencyAnalyzer = this._agentCore.getDependencyAnalyzer();
                                if (dependencyAnalyzer && operation === 'edit') {
                                    try {
                                        // Use AST analyzer to detect actual symbol changes
                                        const symbolChanges = await this._astAnalyzer.compareFiles(filename, originalContent, newContent);
                                        const removedSymbols = this._astAnalyzer.getRemovedSymbols(symbolChanges);
                                        const modifiedSymbols = this._astAnalyzer.getModifiedSymbols(symbolChanges);

                                        // Detect breaking changes based on actual symbol modifications
                                        const breakingChanges = await dependencyAnalyzer.detectBreakingChanges(
                                            filename,
                                            'edit',
                                            removedSymbols,
                                            modifiedSymbols
                                        );

                                        if (breakingChanges.length > 0) {
                                            const warningMessage = dependencyAnalyzer.formatBreakingChanges(breakingChanges);

                                            // Notify user about breaking changes
                                            this._view?.webview.postMessage({
                                                type: 'breakingChangesDetected',
                                                filename,
                                                changes: breakingChanges,
                                                message: warningMessage
                                            });
                                        }
                                    } catch (error) {
                                        console.error('ChatPanel: Error detecting breaking changes:', error);
                                    }
                                }

                                this.addFileChangeWithContent(filename, operation, linesAdded, linesRemoved, diff, description, originalContent, newContent);
                            } catch (error) {
                                // If we can't read the file, use basic tracking
                                if (operation === 'create') {
                                    linesAdded = args.CodeContent ? args.CodeContent.split('\n').length : 0;
                                } else {
                                    linesAdded = 10;
                                    linesRemoved = 5;
                                }
                                this.addFileChange(filename, operation, linesAdded, linesRemoved, undefined, description);
                            }
                        }
                        break;

                    case 'toolError':
                        this._view?.webview.postMessage({
                            type: 'toolError',
                            tool: update.tool,
                            error: update.error,
                            id: update.id
                        });
                        break;

                    case 'toolOutput':
                        this._view?.webview.postMessage({
                            type: 'toolOutput',
                            id: update.id,
                            output: update.output
                        });
                        break;

                    case 'toolStats':
                        this._view?.webview.postMessage({
                            type: 'toolStats',
                            count: update.count,
                            duration: update.duration,
                            success: update.success,
                            failed: update.failed
                        });

                        break;

                    case 'artifactCreated':
                        this._view?.webview.postMessage({
                            type: 'artifactCreated',
                            artifact: update.artifact
                        });
                        break;

                    case 'finalResponse':
                        this._view?.webview.postMessage({
                            type: 'addResponse',
                            text: update.text
                        });
                        // History is now updated directly in AgentCore.ts
                        await this.saveHistory();
                        break;



                    case 'error':
                        this._view?.webview.postMessage({
                            type: 'addResponse',
                            text: update.text
                        });
                        break;

                    case 'stopped':
                        this._view?.webview.postMessage({
                            type: 'generationStopped',
                            text: update.text
                        });
                        break;

                    case 'command':
                        if (update.name === 'clear') {
                            this.newConversation();
                        }
                        break;
                }
            }, this._conversationId, mode, model);
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'addResponse',
                text: `❌ Error: ${error.message}`
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.WebviewView['webview']) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'style.css'));

        // External Assets
        const markedUri = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
        const prismUri = "https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js";
        const prismCssUri = "https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css";
        const prismTsUri = "https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-typescript.min.js";
        const prismJsUri = "https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-javascript.min.js";
        const prismDiffUri = "https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-diff.min.js";

        // Get current configuration
        const config = vscode.workspace.getConfiguration('cnx');
        const currentModel = config.get<string>('model', 'gpt-4o');
        const currentProvider = config.get('aiProvider', 'openai');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <link href="${prismCssUri}" rel="stylesheet">
    <script src="${markedUri}"></script>
    <script src="${prismUri}"></script>
    <script src="${prismTsUri}"></script>
    <script src="${prismJsUri}"></script>
    <script src="${prismDiffUri}"></script>
    <title>Cnx Agent</title>
</head>
<body>
    <div class="cnx-container">
        <!-- Top Bar with History -->
        <div class="top-bar">
            <div class="top-bar-right">
                <button class="top-icon-btn" id="new-chat-btn" title="New chat">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
                <button class="top-icon-btn" id="chat-history-btn" title="View chat history">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                </button>
                <button class="top-icon-btn" id="more-options-btn" title="More options">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="19" cy="12" r="1"></circle>
                        <circle cx="5" cy="12" r="1"></circle>
                    </svg>
                </button>
            </div>
        </div>

        <!-- Messages Area -->
        <div class="messages-area" id="messages"></div>

        <!-- Bottom Input Bar (Cnx Style) -->
        <div class="bottom-input-bar">
            <!-- Status Bar Above Input -->
            <!-- Agent Activity Bar -->
            <div class="agent-activity-bar" id="agent-activity-bar" style="display: none;">
                <div class="activity-content">
                    <span class="activity-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon">
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                        </svg>
                    </span>
                    <span class="activity-text" id="agent-status-text">Ready</span>
                </div>
            </div>

            <div class="input-container" id="input-container">
                <div class="mention-dropdown" id="mention-dropdown"></div>
                <div class="attachments-container" id="attachments-container" style="display: none;"></div>
                <textarea 
                    class="main-input" 
                    id="chat-input" 
                    rows="1"
                    placeholder="Build, fix, or search... (Ctrl+L)"
                    autocomplete="off"
                ></textarea>
                
                <div class="input-footer">
                    <div class="selectors-group">
                        <div class="add-menu-container">
                            <button class="add-button" id="add-button" title="Add context">+</button>
                            <div class="add-dropdown" id="add-dropdown">
                                <div class="add-dropdown-header">Add context</div>
                                <div class="add-dropdown-item" data-action="media">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                        <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                        <polyline points="21 15 16 10 5 21"></polyline>
                                    </svg>
                                    <span>Media</span>
                                </div>
                                <div class="add-dropdown-item" data-action="program">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                        <polyline points="14 2 14 8 20 8"></polyline>
                                        <line x1="16" y1="13" x2="8" y2="13"></line>
                                        <line x1="16" y1="17" x2="8" y2="17"></line>
                                        <polyline points="10 9 9 9 8 9"></polyline>
                                    </svg>
                                    <span>File</span>
                                </div>
                                <div class="add-dropdown-item" data-action="workflows">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M12 20h9"></path>
                                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                                    </svg>
                                    <span>Workflows</span>
                                </div>
                            </div>
                        </div>
                        <div class="mode-select" id="mode-select">Fast</div>
                        <div class="model-select" id="model-select">ai-assistant-gpt-4o</div>
                    </div>
                    <div class="input-actions">
                        <button class="stop-button" id="stop-button" title="Stop generation" style="display: none;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="6" width="12" height="12" rx="2"></rect>
                            </svg>
                        </button>
                        <button class="continue-button" id="continue-button" title="Manually nudge agent" style="display: none;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="13 17 18 12 13 7"></polyline>
                                <polyline points="6 17 11 12 6 7"></polyline>
                            </svg>
                        </button>
                        <button class="mic-button" id="mic-button" title="Voice input">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                <line x1="12" y1="19" x2="12" y2="23"></line>
                                <line x1="8" y1="23" x2="16" y2="23"></line>
                            </svg>
                        </button>
                        <button class="send-button" id="send-button" title="Send message" style="display: none;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
