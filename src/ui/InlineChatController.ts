import * as vscode from 'vscode';
import { AIService } from '../services/AIService';
import { AgentCore } from '../agent/AgentCore';

export class InlineChatController {
    private static instance: InlineChatController | undefined;
    private panel: vscode.WebviewPanel | undefined;
    private aiService: AIService;
    private agentCore: AgentCore;
    private context: vscode.ExtensionContext;
    private history: any[] = [];
    private conversationId: string;

    constructor(context: vscode.ExtensionContext, aiService: AIService) {
        this.context = context;
        this.aiService = aiService;
        this.agentCore = new AgentCore(aiService, context);
        this.conversationId = this.generateConversationId();
        this.loadHistory();
        InlineChatController.instance = this;
    }

    public static getInstance(): InlineChatController | undefined {
        return InlineChatController.instance;
    }

    private generateConversationId(): string {
        return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private loadHistory() {
        this.history = this.context.globalState.get<any[]>('chatHistory') || [];
    }

    private saveHistory() {
        this.context.globalState.update('chatHistory', this.history);
    }

    public show() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'cnxInlineChat',
            'Cnx',
            {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: false
            },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'media')
                ]
            }
        );

        this.panel.webview.html = this.getHtmlContent(this.panel.webview);

        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.type) {
                    case 'sendMessage':
                        await this.handleUserMessage(message.text);
                        break;
                    case 'changeModel':
                        await this.changeModel(message.model);
                        break;
                    case 'changeSpeed':
                        await this.changeSpeed(message.speed);
                        break;
                    case 'openFile':
                        this.openFile(message.path);
                        break;
                    case 'newConversation':
                        this.newConversation();
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    private async handleUserMessage(text: string) {
        if (!this.aiService.isConfigured()) {
            this.panel?.webview.postMessage({
                type: 'addResponse',
                text: '⚠️ Error: Please set your API key in settings.'
            });
            return;
        }

        this.panel?.webview.postMessage({ type: 'addMessage', text, role: 'user' });

        try {
            await this.agentCore.processMessage(text, this.history, (update) => {
                switch (update.type) {
                    case 'textChunk':
                        this.panel?.webview.postMessage({
                            type: 'streamChunk',
                            text: update.text
                        });
                        break;

                    case 'budgetUpdate':
                        this.panel?.webview.postMessage({
                            type: 'budgetUpdate',
                            budget: update.budget
                        });
                        break;

                    case 'suggestedResponses':
                        this.panel?.webview.postMessage({
                            type: 'suggestedResponses',
                            suggestions: update.suggestions
                        });
                        break;

                    case 'toolStart':
                        this.panel?.webview.postMessage({
                            type: 'addToolCall',
                            tool: update.tool,
                            args: JSON.stringify(update.args, null, 2)
                        });
                        break;

                    case 'toolEnd':
                        this.panel?.webview.postMessage({
                            type: 'updateToolResult',
                            tool: update.tool,
                            result: typeof update.result === 'string' ? update.result : JSON.stringify(update.result, null, 2)
                        });
                        break;

                    case 'toolError':
                        this.panel?.webview.postMessage({
                            type: 'toolError',
                            tool: update.tool,
                            error: update.error
                        });
                        break;

                    case 'toolStats':
                        this.panel?.webview.postMessage({
                            type: 'toolStats',
                            count: update.count,
                            duration: update.duration,
                            success: update.success,
                            failed: update.failed
                        });
                        break;

                    case 'finalResponse':
                        this.panel?.webview.postMessage({
                            type: 'addResponse',
                            text: update.text
                        });
                        this.history.push({ role: 'user', parts: [{ text }] });
                        this.history.push({ role: 'model', parts: [{ text: update.text }] });
                        this.saveHistory();
                        break;

                    case 'error':
                        this.panel?.webview.postMessage({
                            type: 'addResponse',
                            text: `❌ Error: ${update.error}`
                        });
                        break;
                }
            }, this.conversationId);
        } catch (error: any) {
            this.panel?.webview.postMessage({
                type: 'addResponse',
                text: `❌ Error: ${error.message}`
            });
        }
    }

    private async changeModel(model: string) {
        const config = vscode.workspace.getConfiguration('cnx');
        await config.update('model', model, vscode.ConfigurationTarget.Global);
        this.panel?.webview.postMessage({
            type: 'addMessage',
            text: `Model changed to ${model}`,
            role: 'system'
        });
    }

    private async changeSpeed(speed: string) {
        // Map speed to actual model
        const modelMap: { [key: string]: string } = {
            'fast': 'ai-assistant-gpt-4o',
            'balanced': 'ai-assistant-gpt-4o',
            'quality': 'ai-assistant-gpt-4o'
        };
        await this.changeModel(modelMap[speed] || 'gpt-4o');
    }

    private openFile(path: string) {
        vscode.workspace.openTextDocument(path).then(doc => {
            vscode.window.showTextDocument(doc);
        });
    }

    public newConversation() {
        this.history = [];
        this.conversationId = this.generateConversationId();
        this.saveHistory();
        this.panel?.webview.postMessage({ type: 'clearChat' });
    }

    private getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'inline-chat.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'inline-chat.css'));

        const config = vscode.workspace.getConfiguration('cnx');
        const currentModel = config.get<string>('model', 'gpt-4o');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Cnx Agent</title>
</head>
<body>
    <div id="chat-container">
        <div id="messages"></div>
        
        <!-- Suggested Responses -->
        <div id="suggested-responses"></div>

        <!-- Bottom Input Bar (Cnx Style) -->
        <div class="bottom-bar">
            <div class="input-section">
                <input 
                    type="text" 
                    id="chat-input" 
                    placeholder="Ask anything (Ctrl+L), @ to mention, / for workflows"
                    autocomplete="off"
                />
                <div class="controls">
                    <select id="speed-select" class="speed-selector">
                        <option value="fast">⚡ Fast</option>
                        <option value="balanced" selected>⚖️ Balanced</option>
                        <option value="quality">💎 Quality</option>
                    </select>
                    <select id="model-select" class="model-selector">
                        <option value="gpt-4o" ${currentModel === 'gpt-4o' ? 'selected' : ''}>GPT-4o</option>
                        <option value="claude-3-sonnet" ${currentModel === 'claude-3-sonnet' ? 'selected' : ''}>Claude Sonnet 4.5</option>
                        <option value="gemini-1.5-pro" ${currentModel === 'gemini-1.5-pro' ? 'selected' : ''}>Gemini 1.5 Pro</option>
                    </select>
                    <button id="mic-button" class="icon-button" title="Voice input">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                            <line x1="12" y1="19" x2="12" y2="23"></line>
                            <line x1="8" y1="23" x2="16" y2="23"></line>
                        </svg>
                    </button>
                    <button id="stop-button" class="icon-button" title="Stop generation" style="display: none;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="2"></rect>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    public dispose() {
        this.panel?.dispose();
        this.agentCore.dispose();
    }
}
