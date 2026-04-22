import * as vscode from 'vscode';
import { ChatPanel } from './ui/ChatPanel';
import { AIService } from './services/AIService';
import { AgentManager } from './services/AgentManager';
import { AgentManagerPanel } from './ui/AgentManagerPanel';
import { FeedbackService } from './services/FeedbackService';
import { BrowserSubAgent } from './services/BrowserSubAgent';
import { DevelopmentModeService } from './services/DevelopmentModeService';
import { SelfHealingService } from './services/SelfHealingService';

let statusBarItem: vscode.StatusBarItem;
let reviewChangesItem: vscode.StatusBarItem;
let developmentModeItem: vscode.StatusBarItem;
let activeAgentCountItem: vscode.StatusBarItem;
let selfHealingStatusItem: vscode.StatusBarItem;

// Core services
let aiService: AIService;
let agentManager: AgentManager;
let feedbackService: FeedbackService;
let developmentModeService: DevelopmentModeService;
let browserSubAgent: BrowserSubAgent;
let chatPanel: ChatPanel;
let selfHealingService: SelfHealingService;

export function activate(context: vscode.ExtensionContext) {
    console.log('Cnx Agent is now active (v0.2.0 - Mission Control)');

    // ──────────────────────────────────────
    // 1. Initialize all services
    // ──────────────────────────────────────
    aiService = new AIService(context);
    developmentModeService = new DevelopmentModeService(context);

    // Auto-discover Ollama models if configured
    const cfg = vscode.workspace.getConfiguration('cnx');
    if (cfg.get<boolean>('ollamaAutoDiscover', true)) {
        aiService.getModelRegistry().fetchProviderStatus('ollama')
            .then(status => {
                if (status.healthy && status.models.length > 0) {
                    vscode.window.setStatusBarMessage(
                        `$(server-process) Ollama: ${status.models.length} model(s) ready`, 5000
                    );
                }
            })
            .catch(() => { /* Ollama not running — silently ignored */ });
    }
    const maxConcurrent = cfg.get<number>('maxConcurrentAgents', 5);
    agentManager = new AgentManager(maxConcurrent);
    feedbackService = new FeedbackService(context);

    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    browserSubAgent = new BrowserSubAgent(workspaceDir);

    chatPanel = new ChatPanel(context, aiService);

    // Initialize Self-Healing Service
    selfHealingService = new SelfHealingService(context, aiService);
    context.subscriptions.push(selfHealingService);

    // ──────────────────────────────────────
    // 2. Register Webview Providers
    // ──────────────────────────────────────
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'cnx.chatView',
            chatPanel,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // ──────────────────────────────────────
    // 3. Status Bar Items
    // ──────────────────────────────────────
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = "$(file) 0 Files With Changes";
    statusBarItem.tooltip = "Files modified by Cnx";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    reviewChangesItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    reviewChangesItem.text = "$(checklist) Review Changes";
    reviewChangesItem.command = 'cnx.reviewChanges';
    reviewChangesItem.tooltip = "Review all changes made by Cnx";
    reviewChangesItem.show();
    context.subscriptions.push(reviewChangesItem);

    // Development Mode status bar
    developmentModeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    developmentModeItem.command = 'cnx.switchMode';
    updateDevelopmentModeStatusBar();
    developmentModeItem.show();
    context.subscriptions.push(developmentModeItem);

    // Active Agent Count status bar
    activeAgentCountItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    activeAgentCountItem.command = 'cnx.openAgentManager';
    updateActiveAgentCountStatusBar();
    activeAgentCountItem.show();
    context.subscriptions.push(activeAgentCountItem);

    // Self-Healing status bar
    selfHealingStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
    selfHealingStatusItem.text = "$(tools) Self-Healing: ON";
    selfHealingStatusItem.command = 'cnx.toggleSelfHealing';
    selfHealingStatusItem.tooltip = "Autonomous error detection and fixing is enabled\nClick to toggle";
    selfHealingStatusItem.show();
    context.subscriptions.push(selfHealingStatusItem);

    // ──────────────────────────────────────
    // 4. Register Commands
    // ──────────────────────────────────────

    // Original commands
    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.openChat', () => {
            vscode.commands.executeCommand('workbench.view.extension.cnx-sidebar');
        })
    );

    // ── Ollama Model Discovery ──
    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.listOllamaModels', async () => {
            const registry = aiService.getModelRegistry();
            const status = await registry.fetchProviderStatus('ollama');
            if (!status.healthy) {
                vscode.window.showWarningMessage(
                    `Ollama not reachable: ${status.message}\n\nMake sure Ollama is running (ollama serve).`
                );
                return;
            }
            if (status.models.length === 0) {
                vscode.window.showInformationMessage('Ollama is running but no models found. Run: ollama pull llama3.2');
                return;
            }
            const picked = await vscode.window.showQuickPick(
                status.models.map(m => ({
                    label: m.displayName,
                    description: m.size,
                    detail: m.description,
                    id: m.id
                })),
                { placeHolder: `${status.models.length} Ollama model(s) available — select to use` }
            );
            if (picked) {
                await vscode.workspace.getConfiguration('cnx').update('model', picked.id, vscode.ConfigurationTarget.Global);
                await vscode.workspace.getConfiguration('cnx').update('aiProvider', 'ollama', vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Switched to Ollama model: ${picked.label}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.newConversation', () => {
            ChatPanel.currentProvider?.newConversation();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.reviewChanges', () => {
            vscode.commands.executeCommand('cnx.openAgentManager');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'cnx');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.activateChat', () => {
            vscode.commands.executeCommand('workbench.view.extension.cnx-sidebar');
        })
    );

    // ── NEW: Agent Manager (Mission Control) ──
    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.openAgentManager', () => {
            const agentCore = (chatPanel as any)._agentCore;
            AgentManagerPanel.createOrShow(
                context,
                agentManager,
                aiService,
                agentCore,
                feedbackService,
                browserSubAgent
            );
        })
    );

    // ── NEW: Toggle between Editor and Agent Manager (Cmd+E) ──
    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.toggleView', () => {
            // Toggle: if Agent Manager is open, close it; otherwise open it
            vscode.commands.executeCommand('cnx.openAgentManager');
        })
    );

    // ── NEW: Spawn Agent from Command Palette ──
    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.spawnAgent', async () => {
            const task = await vscode.window.showInputBox({
                prompt: 'What should the agent work on?',
                placeHolder: 'e.g., "Fix the login bug", "Add dark mode toggle", "Write unit tests"'
            });

            if (!task) { return; }

            const modeItems = developmentModeService.getAllModes().map(m => ({
                label: m.displayName,
                description: m.description,
                mode: m.mode
            }));

            const selectedMode = await vscode.window.showQuickPick(modeItems, {
                placeHolder: 'Select agent execution mode'
            });

            try {
                const agent = agentManager.spawnAgent(task, {
                    name: undefined,
                    mode: (selectedMode?.mode as any) || 'assisted'
                });

                vscode.window.showInformationMessage(
                    `Agent spawned: ${agent.name} (${agent.id.substring(0, 8)})`
                );
                updateActiveAgentCountStatusBar();
                vscode.commands.executeCommand('cnx.openAgentManager');
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to spawn agent: ${error.message}`);
            }
        })
    );

    // ── NEW: Run Browser Test ──
    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.runBrowserTest', async () => {
            const url = await vscode.window.showInputBox({
                prompt: 'Enter the URL to test',
                placeHolder: 'e.g., http://localhost:3000',
                value: 'http://localhost:3000'
            });

            if (!url) { return; }

            try {
                vscode.window.showInformationMessage('Starting browser test...');
                const headless = cfg.get<boolean>('browserTestHeadless', true);

                await browserSubAgent.initialize({ headless });
                const report = await browserSubAgent.runTestFlow(
                    'manual-test',
                    url,
                    [
                        { action: 'navigate', target: url, description: 'Navigate to URL' },
                        { action: 'screenshot', target: 'initial', description: 'Capture initial state' },
                        { action: 'wait', value: '2000', description: 'Wait for page load' },
                        { action: 'screenshot', target: 'loaded', description: 'Capture loaded state' }
                    ],
                    `Browser Test: ${url}`
                );
                await browserSubAgent.cleanup();

                const passed = report.steps.filter(s => s.status === 'passed').length;
                const failed = report.steps.filter(s => s.status === 'failed').length;
                vscode.window.showInformationMessage(
                    `Browser test complete: ${passed} passed, ${failed} failed (${Math.round(report.totalDuration)}ms)`
                );
            } catch (error: any) {
                vscode.window.showErrorMessage(`Browser test failed: ${error.message}`);
            }
        })
    );

    // ── NEW: Switch Development Mode ──
    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.switchMode', async () => {
            const modes = developmentModeService.getAllModes();
            const currentMode = developmentModeService.getCurrentMode();

            const items = modes.map(mode => ({
                label: `${mode.mode === currentMode.mode ? '$(check) ' : '     '}${mode.displayName}`,
                description: mode.mode === currentMode.mode ? '(current)' : '',
                detail: mode.description,
                mode: mode.mode
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Current: ${currentMode.displayName} — Select new development mode`,
                matchOnDetail: true
            });

            if (selected) {
                developmentModeService.setMode(selected.mode);
                updateDevelopmentModeStatusBar();
                vscode.window.showInformationMessage(`Development mode changed to: ${selected.label.trim()}`);
            }
        })
    );


    // ── NEW: Show Agent Statistics ──
    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.showAgentStats', () => {
            const stats = agentManager.getAgentStats();
            const message = [
                `Total: ${stats.total}`,
                `Active: ${stats.active}`,
                `Completed: ${stats.completed}`,
                `Failed: ${stats.failed}`,
                `Queued: ${stats.queued}`,
                `Paused: ${stats.paused}`
            ].join(' | ');
            vscode.window.showInformationMessage(`Agent Stats — ${message}`);
        })
    );

    // ── NEW: Toggle Self-Healing ──
    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.toggleSelfHealing', () => {
            const currentState = selfHealingService ? true : false;
            if (selfHealingService) {
                const newState = !currentState;
                selfHealingService.setEnabled(newState);
                selfHealingStatusItem.text = newState ? "$(tools) Self-Healing: ON" : "$(tools) Self-Healing: OFF";
                selfHealingStatusItem.tooltip = newState
                    ? "Autonomous error detection and fixing is enabled\nClick to toggle"
                    : "Autonomous error detection and fixing is disabled\nClick to toggle";
            }
        })
    );

    // ── NEW: Manual Scan and Fix ──
    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.scanAndFix', async () => {
            if (selfHealingService) {
                await selfHealingService.scanAndFix();
            } else {
                vscode.window.showWarningMessage('Self-Healing Service is not initialized');
            }
        })
    );

    // ── NEW: View Fix History ──
    context.subscriptions.push(
        vscode.commands.registerCommand('cnx.viewFixHistory', () => {
            if (selfHealingService) {
                const history = selfHealingService.getFixHistory();
                if (history.length === 0) {
                    vscode.window.showInformationMessage('No fixes have been applied yet');
                } else {
                    const message = history.map((fix, i) =>
                        `${i + 1}. ${fix.fixDescription} (${fix.filesModified.length} file(s))`
                    ).join('\n');
                    vscode.window.showInformationMessage(`Fix History:\n${message}`);
                }
            }
        })
    );

    // ──────────────────────────────────────
    // 5. Event Listeners
    // ──────────────────────────────────────

    // Listen to self-healing events
    context.subscriptions.push(
        selfHealingService.onErrorDetected((error) => {
            console.log('Error detected:', error);
        })
    );

    context.subscriptions.push(
        selfHealingService.onErrorFixed((fix) => {
            vscode.window.showInformationMessage(`✅ ${fix.fixDescription}`);
        })
    );

    // ──────────────────────────────────────
    // 5. Event Listeners
    // ──────────────────────────────────────

    // Update status bar when development mode changes
    context.subscriptions.push(
        developmentModeService.onModeChange(() => {
            updateDevelopmentModeStatusBar();
        })
    );

    // Update active agent count when agents change
    context.subscriptions.push(
        agentManager.onAgentUpdate(() => {
            updateActiveAgentCountStatusBar();
        })
    );

    context.subscriptions.push(
        agentManager.onAgentStatusChange(() => {
            updateActiveAgentCountStatusBar();
        })
    );

    console.log('Cnx Agent: All services initialized successfully');
    
    return {
        aiService,
        agentManager,
        developmentModeService
    };
}

// ──────────────────────────────────────
// Status Bar Helpers
// ──────────────────────────────────────

function updateDevelopmentModeStatusBar(): void {
    if (!developmentModeItem || !developmentModeService) { return; }
    const currentMode = developmentModeService.getCurrentMode();
    const modeIcons: Record<string, string> = {
        autopilot: '$(rocket)',
        review: '$(eye)',
        assisted: '$(hubot)'
    };
    developmentModeItem.text = `${modeIcons[currentMode.mode] || '$(gear)'} ${currentMode.displayName}`;
    developmentModeItem.tooltip = `Development Mode: ${currentMode.displayName}\n${currentMode.description}\nClick to change`;
}

function updateActiveAgentCountStatusBar(): void {
    if (!activeAgentCountItem || !agentManager) { return; }
    const stats = agentManager.getAgentStats();
    activeAgentCountItem.text = `$(server-process) ${stats.active} Agent${stats.active !== 1 ? 's' : ''}`;
    activeAgentCountItem.tooltip = `Active: ${stats.active} | Queued: ${stats.queued} | Completed: ${stats.completed} | Failed: ${stats.failed}\nClick to open Mission Control`;
}

// ──────────────────────────────────────
// Deactivation & Cleanup
// ──────────────────────────────────────

export function deactivate() {
    console.log('Cnx Agent: Deactivating...');

    // Dispose services
    try { agentManager?.dispose(); } catch (e) { /* already disposed */ }
    try { feedbackService?.dispose(); } catch (e) { /* already disposed */ }
    try { developmentModeService?.dispose(); } catch (e) { /* already disposed */ }
    try { browserSubAgent?.cleanup(); } catch (e) { /* cleanup error */ }

    // Dispose ChatPanel
    ChatPanel.currentProvider?.dispose();

    console.log('Cnx Agent: Deactivated');
}
