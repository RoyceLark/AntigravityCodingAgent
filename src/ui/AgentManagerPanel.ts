import * as vscode from 'vscode';
import { AgentManager, AgentInstance, AgentArtifact, ArtifactComment, AgentLog, AgentFeedback, AgentStats } from '../services/AgentManager';
import { AIService } from '../services/AIService';
import { AgentCore } from '../agent/AgentCore';
import { FeedbackService } from '../services/FeedbackService';
import { BrowserSubAgent } from '../services/BrowserSubAgent';

interface WebviewMessage {
  command: string;
  [key: string]: any;
}

interface MessageToWebview {
  type: string;
  [key: string]: any;
}

/**
 * AgentManagerPanel provides a full-screen "Mission Control" dashboard for spawning,
 * monitoring, and interacting with multiple agents in real-time. This is the primary
 * interface for developers to manage agent execution across their workspace.
 */
export class AgentManagerPanel {
  private static currentPanel: AgentManagerPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private selectedAgentId: string | null = null;
  private logBufferMap: Map<string, AgentLog[]> = new Map();

  constructor(
    private context: vscode.ExtensionContext,
    private agentManager: AgentManager,
    private aiService: AIService,
    private agentCore: AgentCore,
    private feedbackService: FeedbackService,
    private browserSubAgent: BrowserSubAgent,
    panel: vscode.WebviewPanel
  ) {
    this.panel = panel;
    this._subscribeToAgentEvents();
    this._setupWebviewMessageHandler();
    this._sendInitialState();
  }

  /**
   * Creates or shows the Agent Manager Panel. If one already exists, brings it to focus.
   */
  public static createOrShow(
    context: vscode.ExtensionContext,
    agentManager: AgentManager,
    aiService: AIService,
    agentCore: AgentCore,
    feedbackService: FeedbackService,
    browserSubAgent: BrowserSubAgent
  ): AgentManagerPanel {
    const column = vscode.ViewColumn.One;

    // If we already have a panel, show it
    if (AgentManagerPanel.currentPanel) {
      AgentManagerPanel.currentPanel.panel.reveal(column);
      return AgentManagerPanel.currentPanel;
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      'agentManagerPanel',
      'Agent Manager - Mission Control',
      column,
      {
        enableScripts: true,
        enableCommandUris: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
      }
    );

    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'agent-icon.svg');

    const agentManagerPanel = new AgentManagerPanel(
      context,
      agentManager,
      aiService,
      agentCore,
      feedbackService,
      browserSubAgent,
      panel
    );

    AgentManagerPanel.currentPanel = agentManagerPanel;

    panel.onDidDispose(
      () => {
        AgentManagerPanel.currentPanel = undefined;
        agentManagerPanel._cleanup();
      },
      null,
      agentManagerPanel.disposables
    );

    panel.webview.html = agentManagerPanel._getHtmlForWebview();

    return agentManagerPanel;
  }

  /**
   * Toggles the Agent Manager Panel visibility (Cmd+E shortcut support)
   */
  public toggle(): void {
    if (this.panel.visible) {
      this.panel.dispose();
    } else {
      this.panel.reveal(vscode.ViewColumn.One);
    }
  }

  /**
   * Sends initial state to the webview on load
   */
  private _sendInitialState(): void {
    try {
      const agents = this.agentManager.getAllAgents();
      const stats = this.agentManager.getAgentStats();

      const initialState: MessageToWebview = {
        type: 'init',
        agents: agents.map(agent => this._serializeAgent(agent)),
        stats,
        timestamp: Date.now(),
      };

      this.panel.webview.postMessage(initialState);
    } catch (error) {
      this._handleError('Failed to send initial state', error);
    }
  }

  /**
   * Sets up message handler for incoming webview messages
   */
  private _setupWebviewMessageHandler(): void {
    this.panel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        try {
          switch (message.command) {
            case 'spawnAgent':
              await this._handleSpawnAgent(message);
              break;
            case 'pauseAgent':
              await this._handlePauseAgent(message);
              break;
            case 'resumeAgent':
              await this._handleResumeAgent(message);
              break;
            case 'cancelAgent':
              await this._handleCancelAgent(message);
              break;
            case 'selectAgent':
              await this._handleSelectAgent(message);
              break;
            case 'addFeedback':
              await this._handleAddFeedback(message);
              break;
            case 'addComment':
              await this._handleAddComment(message);
              break;
            case 'resolveComment':
              await this._handleResolveComment(message);
              break;
            case 'toggleBackToEditor':
              await this._handleToggleBackToEditor();
              break;
            case 'requestAgentDetails':
              await this._handleRequestAgentDetails(message);
              break;
            case 'clearLogs':
              await this._handleClearLogs(message);
              break;
            default:
              console.warn(`Unknown webview command: ${message.command}`);
          }
        } catch (error) {
          this._handleError(`Error handling command ${message.command}`, error);
        }
      },
      null,
      this.disposables
    );
  }

  /**
   * Subscribes to all AgentManager events to push updates to the webview
   */
  private _subscribeToAgentEvents(): void {
    // Agent update events
    this.agentManager.onAgentUpdate((agent: AgentInstance) => {
      const message: MessageToWebview = {
        type: 'agentUpdate',
        agent: this._serializeAgent(agent),
        timestamp: Date.now(),
      };
      this.panel.webview.postMessage(message);
    }, null, this.disposables);

    // Artifact creation events
    this.agentManager.onArtifactCreated((artifact: AgentArtifact) => {
      const message: MessageToWebview = {
        type: 'artifactCreated',
        agentId: artifact.agentId,
        artifact: artifact,
        timestamp: Date.now(),
      };
      this.panel.webview.postMessage(message);
    }, null, this.disposables);

    // Status change events
    this.agentManager.onAgentStatusChange((payload: { agentId: string; status: string }) => {
      const message: MessageToWebview = {
        type: 'statusChange',
        agentId: payload.agentId,
        status: payload.status,
        timestamp: Date.now(),
      };
      this.panel.webview.postMessage(message);
    }, null, this.disposables);

    // Log addition events
    this.agentManager.onLogAdded((payload: { agentId: string; log: AgentLog }) => {
      const message: MessageToWebview = {
        type: 'logAdded',
        agentId: payload.agentId,
        log: payload.log,
        timestamp: Date.now(),
      };
      this.panel.webview.postMessage(message);
    }, null, this.disposables);
  }

  /**
   * Handles spawn agent command from webview
   */
  private async _handleSpawnAgent(message: WebviewMessage): Promise<void> {
    const { task, mode } = message;

    if (!task || typeof task !== 'string' || task.trim().length === 0) {
      vscode.window.showErrorMessage('Task description cannot be empty');
      return;
    }

    try {
      vscode.window.showInformationMessage(`Spawning agent in ${mode} mode...`);

      const options = {
        mode: mode || 'Autopilot',
        timeout: 3600000, // 1 hour default
      };

      const agent = await this.agentManager.spawnAgent(task, options);

      const message: MessageToWebview = {
        type: 'agentSpawned',
        agent: this._serializeAgent(agent),
        timestamp: Date.now(),
      };

      this.panel.webview.postMessage(message);
    } catch (error) {
      this._handleError('Failed to spawn agent', error);
    }
  }

  /**
   * Handles pause agent command
   */
  private async _handlePauseAgent(message: WebviewMessage): Promise<void> {
    const { agentId } = message;

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    try {
      await this.agentManager.pauseAgent(agentId);
      vscode.window.showInformationMessage(`Agent ${agentId} paused`);
    } catch (error) {
      this._handleError(`Failed to pause agent ${agentId}`, error);
    }
  }

  /**
   * Handles resume agent command
   */
  private async _handleResumeAgent(message: WebviewMessage): Promise<void> {
    const { agentId } = message;

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    try {
      await this.agentManager.resumeAgent(agentId);
      vscode.window.showInformationMessage(`Agent ${agentId} resumed`);
    } catch (error) {
      this._handleError(`Failed to resume agent ${agentId}`, error);
    }
  }

  /**
   * Handles cancel agent command
   */
  private async _handleCancelAgent(message: WebviewMessage): Promise<void> {
    const { agentId } = message;

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    try {
      await this.agentManager.cancelAgent(agentId);
      vscode.window.showInformationMessage(`Agent ${agentId} cancelled`);
    } catch (error) {
      this._handleError(`Failed to cancel agent ${agentId}`, error);
    }
  }

  /**
   * Handles agent selection for detail view
   */
  private async _handleSelectAgent(message: WebviewMessage): Promise<void> {
    const { agentId } = message;

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    this.selectedAgentId = agentId;

    try {
      const agent = this.agentManager.getAgent(agentId);
      if (!agent) {
        throw new Error(`Agent ${agentId} not found`);
      }

      const detailMessage: MessageToWebview = {
        type: 'agentDetails',
        agent: this._serializeAgent(agent),
        timestamp: Date.now(),
      };

      this.panel.webview.postMessage(detailMessage);
    } catch (error) {
      this._handleError(`Failed to select agent ${agentId}`, error);
    }
  }

  /**
   * Handles request for full agent details (including all logs and artifacts)
   */
  private async _handleRequestAgentDetails(message: WebviewMessage): Promise<void> {
    const { agentId } = message;

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    try {
      const agent = this.agentManager.getAgent(agentId);
      if (!agent) {
        throw new Error(`Agent ${agentId} not found`);
      }

      const detailMessage: MessageToWebview = {
        type: 'agentDetailsFull',
        agent: this._serializeAgent(agent),
        timestamp: Date.now(),
      };

      this.panel.webview.postMessage(detailMessage);
    } catch (error) {
      this._handleError(`Failed to request agent details`, error);
    }
  }

  /**
   * Handles feedback submission
   */
  private async _handleAddFeedback(message: WebviewMessage): Promise<void> {
    const { agentId, feedback, artifactId } = message;

    if (!agentId || !feedback) {
      throw new Error('Agent ID and feedback text are required');
    }

    try {
      await this.agentManager.addFeedback(agentId, feedback, artifactId);
      vscode.window.showInformationMessage('Feedback added successfully');
    } catch (error) {
      this._handleError('Failed to add feedback', error);
    }
  }

  /**
   * Handles comment addition on artifacts
   */
  private async _handleAddComment(message: WebviewMessage): Promise<void> {
    const { agentId, artifactId, comment } = message;

    if (!agentId || !artifactId || !comment) {
      throw new Error('Agent ID, artifact ID, and comment text are required');
    }

    try {
      await this.agentManager.addComment(agentId, artifactId, comment);
      vscode.window.showInformationMessage('Comment added successfully');
    } catch (error) {
      this._handleError('Failed to add comment', error);
    }
  }

  /**
   * Handles comment resolution
   */
  private async _handleResolveComment(message: WebviewMessage): Promise<void> {
    const { agentId, artifactId, commentId } = message;

    if (!agentId || !artifactId || !commentId) {
      throw new Error('Agent ID, artifact ID, and comment ID are required');
    }

    try {
      await this.agentManager.resolveComment(agentId, artifactId, commentId);
      vscode.window.showInformationMessage('Comment resolved successfully');
    } catch (error) {
      this._handleError('Failed to resolve comment', error);
    }
  }

  /**
   * Handles toggle back to editor (Cmd+E)
   */
  private async _handleToggleBackToEditor(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  }

  /**
   * Handles clearing logs for an agent
   */
  private async _handleClearLogs(message: WebviewMessage): Promise<void> {
    const { agentId } = message;

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    this.logBufferMap.delete(agentId);

    const clearMessage: MessageToWebview = {
      type: 'logsCleared',
      agentId,
      timestamp: Date.now(),
    };

    this.panel.webview.postMessage(clearMessage);
  }

  /**
   * Serializes an agent instance for webview consumption
   */
  private _serializeAgent(agent: AgentInstance): any {
    return {
      id: agent.id,
      name: agent.name,
      task: agent.task,
      status: agent.status,
      progress: agent.progress,
      currentStep: agent.currentStep,
      mode: agent.mode,
      startedAt: agent.startedAt,
      completedAt: agent.completedAt,
      artifacts: agent.artifacts || [],
      feedback: agent.feedback || [],
      logs: agent.logs || [],
    };
  }

  /**
   * Handles errors gracefully
   */
  private _handleError(message: string, error: unknown): void {
    console.error(message, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`${message}: ${errorMessage}`);
  }

  /**
   * Cleans up resources on panel disposal
   */
  private _cleanup(): void {
    this.disposables.forEach(d => d.dispose());
    this.logBufferMap.clear();
  }

  /**
   * Generates the complete HTML for the webview
   */
  private _getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agent Manager - Mission Control</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            --bg-primary: #1e1e2e;
            --bg-secondary: #282840;
            --bg-tertiary: #313145;
            --accent-purple: #7c3aed;
            --accent-blue: #3b82f6;
            --success-green: #10b981;
            --warning-yellow: #f59e0b;
            --error-red: #ef4444;
            --gray-400: #9ca3af;
            --gray-500: #6b7280;
            --text-primary: #f3f4f6;
            --text-secondary: #d1d5db;
            --border-color: #404055;
        }

        body {
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            font-size: 13px;
            line-height: 1.6;
            height: 100vh;
            overflow: hidden;
        }

        .container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        /* ===== TOP BAR ===== */
        .topbar {
            background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%);
            border-bottom: 1px solid var(--border-color);
            padding: 12px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 20px;
            flex-shrink: 0;
        }

        .topbar-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .topbar-title {
            font-weight: 600;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .topbar-title::before {
            content: '⚙️';
            font-size: 16px;
        }

        .stats-bar {
            display: flex;
            gap: 20px;
            flex: 1;
        }

        .stat {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            border-radius: 4px;
            background: rgba(0, 0, 0, 0.3);
            font-size: 12px;
        }

        .stat-label {
            color: var(--gray-400);
        }

        .stat-value {
            font-weight: 600;
            font-family: 'Monaco', 'Courier New', monospace;
        }

        .stat.active .stat-value {
            color: var(--accent-blue);
        }

        .stat.completed .stat-value {
            color: var(--success-green);
        }

        .stat.failed .stat-value {
            color: var(--error-red);
        }

        .topbar-right {
            display: flex;
            gap: 8px;
        }

        .btn-icon {
            padding: 6px 10px;
            border: 1px solid var(--border-color);
            background: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            color: var(--text-primary);
            cursor: pointer;
            font-size: 11px;
            transition: all 0.2s ease;
        }

        .btn-icon:hover {
            background: rgba(124, 58, 237, 0.15);
            border-color: var(--accent-purple);
            color: var(--accent-purple);
        }

        /* ===== MAIN CONTENT ===== */
        .content {
            display: flex;
            flex: 1;
            overflow: hidden;
            gap: 1px;
            background: var(--border-color);
        }

        .left-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: var(--bg-primary);
        }

        .right-panel {
            width: 350px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: var(--bg-primary);
            border-left: 1px solid var(--border-color);
        }

        /* ===== SPAWN AREA ===== */
        .spawn-area {
            padding: 16px 20px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            flex-shrink: 0;
        }

        .spawn-container {
            display: flex;
            gap: 12px;
            align-items: flex-end;
        }

        .spawn-input-group {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .spawn-label {
            font-size: 11px;
            color: var(--gray-400);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .spawn-input {
            padding: 8px 12px;
            background: rgba(0, 0, 0, 0.4);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--text-primary);
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 12px;
            transition: all 0.2s ease;
        }

        .spawn-input:focus {
            outline: none;
            border-color: var(--accent-purple);
            background: rgba(124, 58, 237, 0.1);
            box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.1);
        }

        .mode-selector {
            display: flex;
            gap: 6px;
        }

        .mode-btn {
            padding: 6px 12px;
            border: 1px solid var(--border-color);
            background: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            color: var(--gray-400);
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            transition: all 0.2s ease;
        }

        .mode-btn.active {
            background: var(--accent-purple);
            color: white;
            border-color: var(--accent-purple);
        }

        .mode-btn:hover {
            border-color: var(--accent-purple);
        }

        .btn-spawn {
            padding: 8px 16px;
            background: linear-gradient(135deg, var(--accent-purple) 0%, #6d28d9 100%);
            border: 1px solid var(--accent-purple);
            border-radius: 4px;
            color: white;
            cursor: pointer;
            font-weight: 600;
            font-size: 12px;
            transition: all 0.3s ease;
            white-space: nowrap;
        }

        .btn-spawn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(124, 58, 237, 0.4);
        }

        .btn-spawn:active {
            transform: translateY(0);
        }

        .btn-spawn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* ===== AGENT GRID ===== */
        .agents-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px 20px;
        }

        .agents-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 12px;
        }

        .agent-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 14px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .agent-card:hover {
            border-color: var(--accent-purple);
            background: rgba(124, 58, 237, 0.05);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .agent-card.selected {
            border-color: var(--accent-purple);
            background: rgba(124, 58, 237, 0.1);
            box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.15);
        }

        .agent-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
        }

        .agent-name {
            font-weight: 600;
            font-size: 13px;
            color: var(--text-primary);
            word-break: break-word;
            flex: 1;
        }

        .agent-status-badge {
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            white-space: nowrap;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .status-completed {
            background: rgba(16, 185, 129, 0.2);
            color: var(--success-green);
        }

        .status-executing {
            background: rgba(59, 130, 246, 0.2);
            color: var(--accent-blue);
            animation: pulse 2s ease-in-out infinite;
        }

        .status-planning {
            background: rgba(245, 158, 11, 0.2);
            color: var(--warning-yellow);
        }

        .status-failed {
            background: rgba(239, 68, 68, 0.2);
            color: var(--error-red);
        }

        .status-paused {
            background: rgba(107, 114, 128, 0.2);
            color: var(--gray-500);
        }

        .status-queued {
            background: rgba(107, 114, 128, 0.2);
            color: var(--gray-400);
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }

        .agent-task {
            font-size: 12px;
            color: var(--gray-400);
            line-height: 1.4;
            word-break: break-word;
            max-height: 36px;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
        }

        .agent-progress {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .progress-bar-container {
            height: 4px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 2px;
            overflow: hidden;
        }

        .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, var(--accent-purple) 0%, var(--accent-blue) 100%);
            transition: width 0.3s ease;
            border-radius: 2px;
        }

        .progress-text {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: var(--gray-500);
            font-family: 'Monaco', 'Courier New', monospace;
        }

        .agent-step {
            font-size: 11px;
            color: var(--gray-400);
            padding: 6px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 3px;
            border-left: 2px solid var(--accent-purple);
            font-family: 'Monaco', 'Courier New', monospace;
            line-height: 1.3;
            max-height: 40px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .agent-actions {
            display: flex;
            gap: 6px;
        }

        .btn-action {
            flex: 1;
            padding: 6px 10px;
            border: 1px solid var(--border-color);
            background: rgba(0, 0, 0, 0.3);
            border-radius: 3px;
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            transition: all 0.2s ease;
        }

        .btn-action:hover {
            border-color: var(--accent-purple);
            color: var(--accent-purple);
        }

        .btn-action.danger:hover {
            border-color: var(--error-red);
            color: var(--error-red);
            background: rgba(239, 68, 68, 0.1);
        }

        /* ===== RIGHT PANEL / DETAIL VIEW ===== */
        .detail-placeholder {
            padding: 20px;
            color: var(--gray-500);
            font-size: 12px;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
        }

        .detail-view {
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        .detail-header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color);
            background: var(--bg-secondary);
            flex-shrink: 0;
        }

        .detail-title {
            font-weight: 600;
            font-size: 12px;
            color: var(--text-primary);
            margin-bottom: 4px;
        }

        .detail-subtitle {
            font-size: 11px;
            color: var(--gray-500);
        }

        .detail-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .tabs {
            display: flex;
            border-bottom: 1px solid var(--border-color);
            background: rgba(0, 0, 0, 0.2);
            flex-shrink: 0;
        }

        .tab {
            padding: 8px 12px;
            border: none;
            background: transparent;
            color: var(--gray-500);
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            border-bottom: 2px solid transparent;
            transition: all 0.2s ease;
            white-space: nowrap;
        }

        .tab:hover {
            color: var(--text-primary);
        }

        .tab.active {
            color: var(--accent-purple);
            border-bottom-color: var(--accent-purple);
        }

        .tab-content {
            flex: 1;
            overflow-y: auto;
            padding: 12px 16px;
            display: none;
        }

        .tab-content.active {
            display: flex;
            flex-direction: column;
        }

        /* Logs Tab */
        .log-container {
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 11px;
        }

        .log-entry {
            padding: 6px 8px;
            border-left: 2px solid;
            border-radius: 2px;
            line-height: 1.4;
            animation: slideIn 0.2s ease;
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-4px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .log-debug {
            border-left-color: var(--gray-500);
            color: var(--gray-400);
            background: rgba(0, 0, 0, 0.2);
        }

        .log-info {
            border-left-color: var(--accent-blue);
            color: var(--accent-blue);
            background: rgba(59, 130, 246, 0.1);
        }

        .log-warn {
            border-left-color: var(--warning-yellow);
            color: var(--warning-yellow);
            background: rgba(245, 158, 11, 0.1);
        }

        .log-error {
            border-left-color: var(--error-red);
            color: var(--error-red);
            background: rgba(239, 68, 68, 0.1);
        }

        .log-success {
            border-left-color: var(--success-green);
            color: var(--success-green);
            background: rgba(16, 185, 129, 0.1);
        }

        .log-timestamp {
            color: var(--gray-500);
            font-size: 10px;
            margin-right: 6px;
        }

        /* Artifacts Tab */
        .artifacts-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .artifact-item {
            background: rgba(0, 0, 0, 0.2);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 10px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .artifact-item:hover {
            border-color: var(--accent-purple);
            background: rgba(124, 58, 237, 0.1);
        }

        .artifact-name {
            font-weight: 500;
            font-size: 11px;
            color: var(--text-primary);
            margin-bottom: 4px;
        }

        .artifact-type {
            display: inline-block;
            padding: 2px 6px;
            background: rgba(124, 58, 237, 0.2);
            color: var(--accent-purple);
            border-radius: 2px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .artifact-preview {
            font-size: 10px;
            color: var(--gray-500);
            margin-top: 4px;
            line-height: 1.3;
            max-height: 40px;
            overflow: hidden;
        }

        /* Feedback Tab */
        .feedback-form {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 12px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border-color);
        }

        .feedback-input {
            padding: 8px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid var(--border-color);
            border-radius: 3px;
            color: var(--text-primary);
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 11px;
            resize: vertical;
            min-height: 60px;
        }

        .feedback-input:focus {
            outline: none;
            border-color: var(--accent-purple);
            background: rgba(124, 58, 237, 0.1);
        }

        .btn-submit {
            padding: 6px 10px;
            background: var(--accent-purple);
            border: none;
            border-radius: 3px;
            color: white;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            transition: all 0.2s ease;
        }

        .btn-submit:hover {
            background: #6d28d9;
        }

        .comments-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .comment {
            background: rgba(0, 0, 0, 0.2);
            border-left: 2px solid var(--accent-purple);
            border-radius: 3px;
            padding: 8px;
        }

        .comment-author {
            font-weight: 600;
            font-size: 10px;
            color: var(--accent-purple);
            margin-bottom: 2px;
        }

        .comment-text {
            font-size: 11px;
            color: var(--text-secondary);
            line-height: 1.3;
        }

        .comment-timestamp {
            font-size: 9px;
            color: var(--gray-500);
            margin-top: 4px;
        }

        /* ===== SCROLLBARS ===== */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: rgba(124, 58, 237, 0.3);
            border-radius: 4px;
            transition: background 0.2s ease;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: rgba(124, 58, 237, 0.6);
        }

        /* ===== ANIMATIONS ===== */
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        .fade-in {
            animation: fadeIn 0.3s ease;
        }

        /* ===== UTILITY ===== */
        .empty-state {
            color: var(--gray-500);
            font-size: 12px;
            text-align: center;
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100px;
        }

        /* ===== RESPONSIVE ===== */
        @media (max-width: 1200px) {
            .agents-grid {
                grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            }
        }

        @media (max-width: 768px) {
            .content {
                flex-direction: column;
            }

            .right-panel {
                width: 100%;
                height: 300px;
                border-left: none;
                border-top: 1px solid var(--border-color);
            }

            .agents-grid {
                grid-template-columns: 1fr;
            }

            .spawn-container {
                flex-direction: column;
            }

            .mode-selector {
                width: 100%;
            }

            .btn-spawn {
                width: 100%;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- TOP BAR -->
        <div class="topbar">
            <div class="topbar-left">
                <div class="topbar-title">Mission Control</div>
                <div class="stats-bar">
                    <div class="stat active">
                        <span class="stat-label">Active:</span>
                        <span class="stat-value" id="stat-active">0</span>
                    </div>
                    <div class="stat completed">
                        <span class="stat-label">Completed:</span>
                        <span class="stat-value" id="stat-completed">0</span>
                    </div>
                    <div class="stat failed">
                        <span class="stat-label">Failed:</span>
                        <span class="stat-value" id="stat-failed">0</span>
                    </div>
                </div>
            </div>
            <div class="topbar-right">
                <button class="btn-icon" id="btn-editor" title="Back to Editor (Cmd+E)">↵ Editor</button>
            </div>
        </div>

        <!-- MAIN CONTENT -->
        <div class="content">
            <!-- LEFT PANEL: AGENTS -->
            <div class="left-panel">
                <!-- SPAWN AREA -->
                <div class="spawn-area">
                    <div class="spawn-container">
                        <div class="spawn-input-group">
                            <label class="spawn-label">New Agent Task</label>
                            <input type="text" id="spawn-input" class="spawn-input" placeholder="e.g., Write a blog post about AI safety..." />
                        </div>
                        <div class="mode-selector" id="mode-selector">
                            <button class="mode-btn active" data-mode="Autopilot">🤖 Autopilot</button>
                            <button class="mode-btn" data-mode="Review">👁️ Review</button>
                            <button class="mode-btn" data-mode="Assisted">🤝 Assisted</button>
                        </div>
                        <button class="btn-spawn" id="btn-spawn">Spawn</button>
                    </div>
                </div>

                <!-- AGENTS GRID -->
                <div class="agents-container">
                    <div class="agents-grid" id="agents-grid">
                        <div class="empty-state">No agents spawned yet. Create one to get started!</div>
                    </div>
                </div>
            </div>

            <!-- RIGHT PANEL: DETAIL VIEW -->
            <div class="right-panel">
                <div id="detail-placeholder" class="detail-placeholder">
                    Select an agent to view details
                </div>
                <div id="detail-view" class="detail-view" style="display: none;">
                    <div class="detail-header">
                        <div class="detail-title" id="detail-agent-name">Agent Name</div>
                        <div class="detail-subtitle" id="detail-agent-status">Status: Unknown</div>
                    </div>
                    <div class="tabs">
                        <button class="tab active" data-tab="logs">📋 Logs</button>
                        <button class="tab" data-tab="artifacts">📦 Artifacts</button>
                        <button class="tab" data-tab="feedback">💬 Feedback</button>
                    </div>
                    <div class="detail-content">
                        <!-- LOGS TAB -->
                        <div class="tab-content active" id="logs-tab">
                            <div class="log-container" id="log-container">
                                <div class="empty-state">No logs yet</div>
                            </div>
                        </div>

                        <!-- ARTIFACTS TAB -->
                        <div class="tab-content" id="artifacts-tab">
                            <div class="artifacts-list" id="artifacts-list">
                                <div class="empty-state">No artifacts yet</div>
                            </div>
                        </div>

                        <!-- FEEDBACK TAB -->
                        <div class="tab-content" id="feedback-tab">
                            <div class="feedback-form">
                                <textarea class="feedback-input" id="feedback-input" placeholder="Add feedback or comments..."></textarea>
                                <button class="btn-submit" id="btn-submit-feedback">Submit Feedback</button>
                            </div>
                            <div class="comments-list" id="comments-list">
                                <div class="empty-state">No feedback yet</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // ===== STATE =====
        let agents = new Map();
        let selectedAgentId = null;
        let selectedMode = 'Autopilot';
        const logBuffers = new Map();

        // ===== INITIALIZATION =====
        window.addEventListener('message', (event) => {
            const message = event.data;
            handleMessage(message);
        });

        // ===== MESSAGE HANDLING =====
        function handleMessage(message) {
            try {
                switch (message.type) {
                    case 'init':
                        handleInit(message);
                        break;
                    case 'agentSpawned':
                        handleAgentSpawned(message);
                        break;
                    case 'agentUpdate':
                        handleAgentUpdate(message);
                        break;
                    case 'artifactCreated':
                        handleArtifactCreated(message);
                        break;
                    case 'statusChange':
                        handleStatusChange(message);
                        break;
                    case 'logAdded':
                        handleLogAdded(message);
                        break;
                    case 'agentDetails':
                        handleAgentDetails(message);
                        break;
                    case 'agentDetailsFull':
                        handleAgentDetailsFull(message);
                        break;
                    case 'logsCleared':
                        handleLogsCleared(message);
                        break;
                    default:
                        console.warn('Unknown message type:', message.type);
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        }

        function handleInit(message) {
            agents.clear();
            logBuffers.clear();

            if (message.agents && Array.isArray(message.agents)) {
                message.agents.forEach(agent => {
                    agents.set(agent.id, agent);
                    logBuffers.set(agent.id, agent.logs || []);
                });
            }

            updateStats(message.stats);
            renderAgentCards();
        }

        function handleAgentSpawned(message) {
            const agent = message.agent;
            agents.set(agent.id, agent);
            logBuffers.set(agent.id, []);
            updateStats(message.stats);
            renderAgentCards();
        }

        function handleAgentUpdate(message) {
            const agent = message.agent;
            agents.set(agent.id, agent);
            renderAgentCard(agent.id);
            if (selectedAgentId === agent.id) {
                renderDetailView(agent.id);
            }
        }

        function handleArtifactCreated(message) {
            const agent = agents.get(message.agentId);
            if (agent) {
                agent.artifacts = agent.artifacts || [];
                agent.artifacts.push(message.artifact);
                if (selectedAgentId === message.agentId) {
                    renderDetailView(message.agentId);
                }
            }
        }

        function handleStatusChange(message) {
            const agent = agents.get(message.agentId);
            if (agent) {
                agent.status = message.status;
                renderAgentCard(message.agentId);
                if (selectedAgentId === message.agentId) {
                    renderDetailHeader(message.agentId);
                }
            }
        }

        function handleLogAdded(message) {
            const agentId = message.agentId;
            if (!logBuffers.has(agentId)) {
                logBuffers.set(agentId, []);
            }
            logBuffers.get(agentId).push(message.log);

            if (selectedAgentId === agentId) {
                renderLogs(agentId);
                autoScrollLogs();
            }
        }

        function handleAgentDetails(message) {
            const agent = message.agent;
            agents.set(agent.id, agent);
            selectedAgentId = agent.id;
            renderDetailView(agent.id);
        }

        function handleAgentDetailsFull(message) {
            const agent = message.agent;
            agents.set(agent.id, agent);
            logBuffers.set(agent.id, agent.logs || []);
            selectedAgentId = agent.id;
            renderDetailView(agent.id);
        }

        function handleLogsCleared(message) {
            logBuffers.delete(message.agentId);
            if (selectedAgentId === message.agentId) {
                renderLogs(message.agentId);
            }
        }

        // ===== RENDERING =====
        function renderAgentCards() {
            const grid = document.getElementById('agents-grid');
            grid.innerHTML = '';

            if (agents.size === 0) {
                grid.innerHTML = '<div class="empty-state">No agents spawned yet. Create one to get started!</div>';
                return;
            }

            agents.forEach((agent) => {
                renderAgentCard(agent.id);
            });
        }

        function renderAgentCard(agentId) {
            const agent = agents.get(agentId);
            if (!agent) return;

            let cardElement = document.getElementById(\`agent-card-\${agentId}\`);
            if (!cardElement) {
                const grid = document.getElementById('agents-grid');
                cardElement = document.createElement('div');
                cardElement.id = \`agent-card-\${agentId}\`;
                cardElement.className = 'agent-card';
                grid.appendChild(cardElement);
                cardElement.addEventListener('click', () => selectAgent(agentId));
            }

            const statusClass = \`status-\${(agent.status || 'queued').toLowerCase()}\`;
            const progress = Math.min(100, Math.max(0, agent.progress || 0));

            cardElement.innerHTML = \`
                <div class="agent-header">
                    <div class="agent-name">\${escapeHtml(agent.name || 'Agent ' + agentId.slice(0, 8))}</div>
                    <span class="agent-status-badge \${statusClass}">\${agent.status || 'Queued'}</span>
                </div>
                <div class="agent-task">\${escapeHtml(agent.task || 'No task description')}</div>
                <div class="agent-progress">
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: \${progress}%"></div>
                    </div>
                    <div class="progress-text">
                        <span>\${agent.mode || 'Autopilot'}</span>
                        <span>\${progress}%</span>
                    </div>
                </div>
                \${agent.currentStep ? \`<div class="agent-step">\${escapeHtml(agent.currentStep)}</div>\` : ''}
                <div class="agent-actions">
                    \${agent.status === 'executing' ? \`
                        <button class="btn-action" onclick="pauseAgent('\${agentId}')">⏸ Pause</button>
                    \` : agent.status === 'paused' ? \`
                        <button class="btn-action" onclick="resumeAgent('\${agentId}')">▶ Resume</button>
                    \` : ''}
                    <button class="btn-action danger" onclick="cancelAgent('\${agentId}')">✕ Cancel</button>
                </div>
            \`;

            if (selectedAgentId === agentId) {
                cardElement.classList.add('selected');
            } else {
                cardElement.classList.remove('selected');
            }
        }

        function renderDetailView(agentId) {
            const agent = agents.get(agentId);
            if (!agent) return;

            const placeholder = document.getElementById('detail-placeholder');
            const detailView = document.getElementById('detail-view');

            placeholder.style.display = 'none';
            detailView.style.display = 'flex';

            renderDetailHeader(agentId);
            renderLogs(agentId);
            renderArtifacts(agentId);
            renderFeedback(agentId);
        }

        function renderDetailHeader(agentId) {
            const agent = agents.get(agentId);
            if (!agent) return;

            document.getElementById('detail-agent-name').textContent = agent.name || 'Agent ' + agentId.slice(0, 8);
            document.getElementById('detail-agent-status').textContent = \`Status: \${agent.status || 'Unknown'} • Progress: \${agent.progress || 0}%\`;
        }

        function renderLogs(agentId) {
            const container = document.getElementById('log-container');
            const logs = logBuffers.get(agentId) || [];

            if (logs.length === 0) {
                container.innerHTML = '<div class="empty-state">No logs yet</div>';
                return;
            }

            container.innerHTML = logs.map(log => {
                const levelClass = \`log-\${(log.level || 'info').toLowerCase()}\`;
                const timestamp = new Date(log.timestamp).toLocaleTimeString();
                return \`
                    <div class="log-entry \${levelClass}">
                        <span class="log-timestamp">\${timestamp}</span>
                        <span>\${escapeHtml(log.message || '')}</span>
                    </div>
                \`;
            }).join('');
        }

        function renderArtifacts(agentId) {
            const agent = agents.get(agentId);
            const container = document.getElementById('artifacts-list');
            const artifacts = agent?.artifacts || [];

            if (artifacts.length === 0) {
                container.innerHTML = '<div class="empty-state">No artifacts yet</div>';
                return;
            }

            container.innerHTML = artifacts.map(artifact => \`
                <div class="artifact-item">
                    <div class="artifact-name">\${escapeHtml(artifact.name || 'Untitled')}</div>
                    <span class="artifact-type">\${escapeHtml(artifact.type || 'unknown')}</span>
                    <div class="artifact-preview">\${escapeHtml((artifact.content || '').slice(0, 80))}</div>
                </div>
            \`).join('');
        }

        function renderFeedback(agentId) {
            const agent = agents.get(agentId);
            const container = document.getElementById('comments-list');
            const feedback = agent?.feedback || [];

            if (feedback.length === 0) {
                container.innerHTML = '<div class="empty-state">No feedback yet</div>';
                return;
            }

            container.innerHTML = feedback.map(fb => \`
                <div class="comment">
                    <div class="comment-author">You</div>
                    <div class="comment-text">\${escapeHtml(fb.text || '')}</div>
                    <div class="comment-timestamp">\${new Date(fb.timestamp).toLocaleString()}</div>
                </div>
            \`).join('');
        }

        function updateStats(stats) {
            if (!stats) return;
            document.getElementById('stat-active').textContent = stats.active || 0;
            document.getElementById('stat-completed').textContent = stats.completed || 0;
            document.getElementById('stat-failed').textContent = stats.failed || 0;
        }

        // ===== INTERACTIONS =====
        function selectAgent(agentId) {
            selectedAgentId = agentId;
            renderAgentCards();
            vscode.postMessage({ command: 'selectAgent', agentId });
        }

        function spawnAgent() {
            const input = document.getElementById('spawn-input');
            const task = input.value.trim();

            if (!task) {
                alert('Please enter a task description');
                return;
            }

            vscode.postMessage({
                command: 'spawnAgent',
                task,
                mode: selectedMode,
            });

            input.value = '';
        }

        function pauseAgent(agentId) {
            vscode.postMessage({ command: 'pauseAgent', agentId });
        }

        function resumeAgent(agentId) {
            vscode.postMessage({ command: 'resumeAgent', agentId });
        }

        function cancelAgent(agentId) {
            if (confirm(\`Cancel agent \${agentId}?\`)) {
                vscode.postMessage({ command: 'cancelAgent', agentId });
            }
        }

        function submitFeedback() {
            const input = document.getElementById('feedback-input');
            const feedback = input.value.trim();

            if (!feedback || !selectedAgentId) {
                alert('Please enter feedback');
                return;
            }

            vscode.postMessage({
                command: 'addFeedback',
                agentId: selectedAgentId,
                feedback,
            });

            input.value = '';
        }

        function autoScrollLogs() {
            const container = document.getElementById('log-container');
            container.scrollTop = container.scrollHeight;
        }

        // ===== TAB SWITCHING =====
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                tab.classList.add('active');
                const tabName = tab.getAttribute('data-tab');
                document.getElementById(\`\${tabName}-tab\`).classList.add('active');
            });
        });

        // ===== MODE SELECTOR =====
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedMode = btn.getAttribute('data-mode');
            });
        });

        // ===== EVENT LISTENERS =====
        document.getElementById('btn-spawn').addEventListener('click', spawnAgent);
        document.getElementById('spawn-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                spawnAgent();
            }
        });

        document.getElementById('btn-editor').addEventListener('click', () => {
            vscode.postMessage({ command: 'toggleBackToEditor' });
        });

        document.getElementById('btn-submit-feedback').addEventListener('click', submitFeedback);
        document.getElementById('feedback-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                submitFeedback();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
                e.preventDefault();
                vscode.postMessage({ command: 'toggleBackToEditor' });
            }
        });

        // ===== UTILITIES =====
        function escapeHtml(text) {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text.replace(/[&<>"']/g, m => map[m]);
        }
    </script>
</body>
</html>`;
  }
}
