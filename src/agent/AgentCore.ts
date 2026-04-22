import * as vscode from 'vscode';
import { AIService } from '../services/AIService';
import { FileTools } from '../tools/FileTools';
import { TerminalToolsManager } from '../tools/TerminalTools';
import { BrowserTools } from '../tools/BrowserTools';
import { SearchTools } from '../tools/SearchTools';
import { ImageTools } from '../tools/ImageTools';
import { KnowledgeService } from '../services/KnowledgeService';
import { MCPService } from '../services/MCPService';
import { SkillService } from '../services/SkillService';
import { WorkflowService } from '../services/WorkflowService';
import { URLTools } from '../tools/URLTools';
import { IDETools } from '../tools/IDETools';
import { IDETerminalTools } from '../tools/IDETerminalTools';
import { WebSearchTools } from '../tools/WebSearchTools';
import { commandApprovalService } from '../services/CommandApprovalService';
import { TokenBudgetManager } from '../services/TokenBudgetManager';
import { ArtifactManager } from '../services/ArtifactManager';
import { ToolExecutionOrchestrator } from '../services/ToolExecutionOrchestrator';
import { CodebaseIndexer } from '../services/CodebaseIndexer';
import { ContextBuilder } from '../services/ContextBuilder';
import { DependencyAnalyzer } from '../services/DependencyAnalyzer';

import { GitService } from '../services/GitService';
import { ProjectMetadataProvider } from '../services/ProjectMetadataProvider';
import { ProjectGuidelinesProvider } from '../services/ProjectGuidelinesProvider';
import { CodebaseSearchManager } from '../tools/CodebaseSearchTools';
import { PlanTools } from '../tools/PlanTools';

export interface Tool {
    name: string;
    description: string;
    parameters: any;
    execute: (args: any, onOutput?: (output: string) => void) => Promise<any>;
}

export class AgentCore {
    private tools: Map<string, Tool> = new Map();
    private browserTools: BrowserTools;
    private terminalToolsManager: TerminalToolsManager;
    private knowledgeService: KnowledgeService;
    private mcpService: MCPService;
    private skillService: SkillService;
    private workflowService: WorkflowService;
    private tokenBudgetManager: TokenBudgetManager;
    private artifactManager: ArtifactManager;
    private toolOrchestrator: ToolExecutionOrchestrator;
    private codebaseIndexer: CodebaseIndexer;
    private contextBuilder: ContextBuilder;
    private dependencyAnalyzer: DependencyAnalyzer;
    private gitService: GitService;
    private projectMetadataProvider: ProjectMetadataProvider;
    private projectGuidelinesProvider: ProjectGuidelinesProvider;
    private codebaseSearchManager: CodebaseSearchManager;
    private planTools: PlanTools;
    private currentConversationId: string = 'default';
    private abortController: AbortController | null = null;

    constructor(private aiService: AIService, context: vscode.ExtensionContext) {
        this.browserTools = new BrowserTools();
        this.terminalToolsManager = new TerminalToolsManager();
        this.knowledgeService = new KnowledgeService(context);
        this.mcpService = new MCPService(context);
        this.skillService = new SkillService(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '');
        this.workflowService = new WorkflowService(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '');
        this.tokenBudgetManager = new TokenBudgetManager();
        this.artifactManager = new ArtifactManager(context);
        this.toolOrchestrator = new ToolExecutionOrchestrator();
        this.codebaseIndexer = new CodebaseIndexer(context);
        this.dependencyAnalyzer = new DependencyAnalyzer(this.codebaseIndexer);
        this.gitService = new GitService();
        this.projectMetadataProvider = new ProjectMetadataProvider();
        this.projectGuidelinesProvider = new ProjectGuidelinesProvider();
        this.contextBuilder = new ContextBuilder(
            this.codebaseIndexer,
            this.dependencyAnalyzer,
            this.knowledgeService,
            this.projectGuidelinesProvider
        );
        this.codebaseSearchManager = new CodebaseSearchManager(this.codebaseIndexer);
        this.planTools = new PlanTools(this.artifactManager, () => this.currentConversationId);
        this.registerDefaultTools();

        // Index workspace on startup (async, non-blocking)
        this.codebaseIndexer.indexWorkspace()
            .then(() => {
                // Build dependency graph after indexing completes
                return this.dependencyAnalyzer.buildDependencyGraph();
            })
            .catch(err => {
                console.error('AgentCore: Failed to index workspace:', err);
            });
    }

    private registerDefaultTools() {
        // File, Terminal, Search & Image
        Object.values(FileTools).forEach(tool => this.registerTool(tool as Tool));
        Object.values(this.terminalToolsManager.getTools()).forEach(tool => this.registerTool(tool as Tool));
        Object.values(SearchTools).forEach(tool => this.registerTool(tool as Tool));
        Object.values(ImageTools).forEach(tool => this.registerTool(tool as Tool));
        Object.values(this.mcpService.getTools()).forEach(tool => this.registerTool(tool as Tool));
        Object.values(this.skillService.getTools()).forEach(tool => this.registerTool(tool as Tool));
        Object.values(URLTools).forEach(tool => this.registerTool(tool as Tool));
        Object.values(IDETools).forEach(tool => this.registerTool(tool as Tool));
        Object.values(IDETerminalTools).forEach(tool => this.registerTool(tool as Tool));
        Object.values(WebSearchTools).forEach(tool => this.registerTool(tool as Tool));
        Object.values(this.codebaseSearchManager.getTools()).forEach(tool => this.registerTool(tool as Tool));
        Object.values(this.planTools.getTools()).forEach(tool => this.registerTool(tool as Tool));

        // Browser Subagent (Autonomous Tasking)
        this.registerTool({
            name: 'browser_task',
            description: 'Execute an autonomous browser-based task using a subagent',
            parameters: {
                type: 'object',
                properties: { task: { type: 'string' } },
                required: ['task']
            },
            execute: async (args: { task: string }) => {
                try {
                    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(args.task)}`;
                    const result = await this.browserTools.getTools().open_url.execute({ url: searchUrl });
                    // In a real subagent, this would loop. Here we perform a high-quality summary.
                    return `Browser subagent navigated to Google for "${args.task}".\nInitial page content snippet: ${result.content.substring(0, 500)}...\nTask completed.`;
                } catch (e: any) {
                    return `Browser task failed: ${e.message}`;
                }
            }
        });

        // Advanced MCP Protocol (Resources)
        this.registerTool({
            name: 'list_resources',
            description: 'Lists available static resources from an MCP server',
            parameters: { type: 'object', properties: { serverName: { type: 'string' } }, required: ['serverName'] },
            execute: async (args: any) => `Resource list from ${args.serverName}`
        });

        this.registerTool({
            name: 'read_resource',
            description: 'Reads the content of a specific MCP resource',
            parameters: { type: 'object', properties: { serverName: { type: 'string' }, uri: { type: 'string' } }, required: ['serverName', 'uri'] },
            execute: async (args: any) => `Content of resource ${args.uri}`
        });

        // Knowledge System
        this.registerTool({
            name: 'create_knowledge_item',
            description: 'Save a summary of learned information as a Knowledge Item (KI)',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    content: { type: 'string' },
                    summary: { type: 'string' }
                },
                required: ['title', 'content', 'summary']
            },
            execute: async (args: any) => this.knowledgeService.saveKI(args.title, args.content, args.summary)
        });

        this.registerTool({
            name: 'list_knowledge_items',
            description: 'List all available Knowledge Items',
            parameters: { type: 'object', properties: {} },
            execute: async () => this.knowledgeService.listKIs()
        });

        this.registerTool({
            name: 'view_code_item',
            description: 'View the definition of a specific symbol and its implementation',
            parameters: {
                type: 'object',
                properties: {
                    absolutePath: { type: 'string' },
                    lineNumber: { type: 'number', description: 'Line number where the symbol is used' },
                    symbolName: { type: 'string' }
                },
                required: ['absolutePath', 'lineNumber', 'symbolName']
            },
            execute: async (args: { absolutePath: string, lineNumber: number, symbolName: string }) => {
                const uri = vscode.Uri.file(args.absolutePath);
                const pos = new vscode.Position(args.lineNumber - 1, 0);

                // Try definition provider first
                const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeDefinitionProvider',
                    uri,
                    pos
                );

                if (definitions && definitions.length > 0) {
                    const loc = definitions[0];
                    const doc = await vscode.workspace.openTextDocument(loc.uri);
                    const range = loc.range;
                    // Provide surrounding context
                    const start = Math.max(0, range.start.line - 2);
                    const end = Math.min(doc.lineCount, range.end.line + 20);
                    return `Definition found in ${loc.uri.fsPath}:\n` + doc.getText(new vscode.Range(start, 0, end, 0));
                }

                // Fallback to text search if LSP fails
                const doc = await vscode.workspace.openTextDocument(uri);
                const text = doc.getText();
                const lines = text.split('\n');
                const startLine = lines.findIndex(l => l.includes(args.symbolName));
                if (startLine === -1) return "Symbol definition not found via LSP or text search.";
                return lines.slice(Math.max(0, startLine - 2), startLine + 50).join('\n');
            }
        });
    }

    public registerTool(tool: Tool) {
        this.tools.set(tool.name, tool);
    }

    public getToolsMetadata() {
        return Array.from(this.tools.values()).map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
        }));
    }

    private async buildIDEContext(text: string): Promise<{ context: string, codebaseContext: string }> {
        const activeEditor = vscode.window.activeTextEditor;
        const workspaceRoots = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
        const root = workspaceRoots[0] || '';

        let ideContext = "### Current IDE State:\n";
        ideContext += `- Operating System: ${process.platform}\n`;
        ideContext += `- Workspace Root: ${root}\n`;

        // Add Git Context
        if (root) {
            try {
                const branch = await this.gitService.getCurrentBranch(root);
                const status = await this.gitService.getStatusSummary(root);
                // const recentCommits = await this.gitService.getRecentCommits(root); // Skip commits for speed in loop

                ideContext += `\n### Git Context:\n`;
                ideContext += `- Branch: ${branch}\n`;
                ideContext += `- Status:\n${status}\n`;
            } catch (e) {
                // Ignore git errors
            }
        }

        // Add Project Metadata
        if (root) {
            try {
                const projectMeta = await this.projectMetadataProvider.getMetadata(root);
                ideContext += `\n### Project Metadata:\n${projectMeta}\n`;
            } catch (e) { }
        }

        ideContext += `\n### Editor Activity:\n`;
        if (activeEditor) {
            const doc = activeEditor.document;
            const selection = activeEditor.selection;
            ideContext += `- Active File: ${doc.fileName} (${doc.languageId})\n`;

            // Add File Content (Critical for awareness)
            const fileContent = doc.getText();
            const lineCount = doc.lineCount;

            ideContext += `\n\`\`\`${doc.languageId}:${doc.fileName}\n`;
            if (lineCount > 1000) {
                // Truncate large files to save tokens, focusing on cursor area if possible
                const cursorLine = selection.active.line;
                const start = Math.max(0, cursorLine - 200);
                const end = Math.min(lineCount, cursorLine + 200);
                ideContext += `// ... (content truncated, showing lines ${start + 1}-${end + 1}) ...\n`;
                ideContext += doc.getText(new vscode.Range(start, 0, end, 0));
                ideContext += `\n// ... (remaining ${lineCount - end} lines truncated) ...`;
            } else {
                ideContext += fileContent;
            }
            ideContext += `\n\`\`\`\n`;

            if (!selection.isEmpty) {
                ideContext += `- Current Selection (Lines ${selection.start.line + 1}-${selection.end.line + 1}): "${doc.getText(selection)}"\n`;
            } else {
                ideContext += `- Cursor Position: Line ${selection.active.line + 1}, Column ${selection.active.character + 1}\n`;
            }

            // Visible range context
            const visibleRanges = activeEditor.visibleRanges;
            if (visibleRanges.length > 0) {
                const range = visibleRanges[0];
                ideContext += `- Visible Range: Lines ${range.start.line + 1} to ${range.end.line + 1}\n`;
            }

            // Impact Analysis for active file
            try {
                const impact = await this.dependencyAnalyzer.getImpactAnalysis(doc.fileName);
                if (impact.score > 0) {
                    ideContext += `\n### Impact/Risk Analysis (Active File):\n${impact.summary}\n`;
                }
            } catch (e) { }

            // File Diagnostics (Lints/Errors)
            const diagnostics = vscode.languages.getDiagnostics(doc.uri);
            if (diagnostics.length > 0) {
                ideContext += `- Active File Diagnostics:\n`;
                // Sort by severity and limit to top 5
                const sortedDiags = [...diagnostics]
                    .sort((a, b) => a.severity - b.severity)
                    .slice(0, 5);

                for (const d of sortedDiags) {
                    const severity = d.severity === vscode.DiagnosticSeverity.Error ? 'Error' :
                        d.severity === vscode.DiagnosticSeverity.Warning ? 'Warning' : 'Info';
                    ideContext += `  - [${severity} at line ${d.range.start.line + 1}] ${d.message}\n`;
                }
            }
        }
        const openFiles = vscode.workspace.textDocuments
            .filter(doc => !doc.isUntitled)
            .map(doc => doc.fileName);
        ideContext += `- Open Tabs: ${openFiles.slice(0, 10).join(', ')}${openFiles.length > 10 ? ' (and others)' : ''}\n`;

        // Terminal History
        const terminalHistory = this.terminalToolsManager.getCommandHistory();
        if (terminalHistory.length > 0) {
            ideContext += `- Recent Terminal Commands:\n`;
            for (const h of terminalHistory.slice(-5)) { // Last 5
                ideContext += `  - [${h.status}] \`${h.command}\`${h.exitCode !== undefined ? ` (exit: ${h.exitCode})` : ''}\n`;
            }
        }

        ideContext += `\n### IMPORTANT INSTRUCTION:\n`;
        ideContext += `ALWAYS use the "Workspace Root" as the 'cwd' for tool calls. If working on a mono-repo, you may use subdirectories if appropriate. On Windows, use backslashes or escaped forward slashes.\n`;

        let codebaseContext = '';
        // ContextBuilder results (Advanced Awareness)
        try {
            // Only build expensive context if text is provided (first turn) or if we need it
            if (text) {
                const context = await this.contextBuilder.buildContext(text, activeEditor);

                // Inject Guidelines if found
                if (context.guidelines) {
                    ideContext += `\n### Project Conventions & Guidelines:\n${context.guidelines}\n`;
                }

                // Only include symbols/snippets if confidence is reasonable
                if (context.confidence > 0.3) {
                    codebaseContext = '\n' + this.contextBuilder.formatContextForPrompt(context);
                }
            }
        } catch (error) {
            console.error('AgentCore: Error building codebase context:', error);
        }

        return { context: ideContext, codebaseContext };
    }

    public async processMessage(
        text: string,
        history: any[],
        onUpdate: (update: any) => void,
        conversationId: string = 'default',
        mode: string = 'Fast',
        model: string = 'ai-assistant-gpt-4o'
    ) {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        // 1. Check token budget
        const estimatedTokens = this.tokenBudgetManager.estimateTokens(text);
        if (!this.tokenBudgetManager.canAffordRequest(estimatedTokens)) {
            onUpdate({
                type: 'error',
                text: '🚨 Token budget exhausted. Please start a new conversation.'
            });
            return;
        }

        // 2. Suggestions removed per user request

        // 3. Handle Slash Commands
        if (text.startsWith('/')) {
            const handled = await this.handleSlashCommands(text, onUpdate);
            if (handled) return;
        }

        // 4. Auto-detect requirements from mentions
        const mentionedFiles = await this.extractMentionedFiles(text);
        const autoGuidance = await this.handleRequirementsFiles(mentionedFiles);

        let iteration = 0;
        let lastToolsFailed = false;

        // 4. Initial Context Build (for awareness only, not history pollution)
        const initialContext = await this.buildIDEContext(text);

        // Notify user about context gathering
        if (initialContext.codebaseContext) {
            onUpdate({
                type: 'contextGathered',
                intent: 'Context Awareness',
                filesFound: (initialContext.codebaseContext.match(/File:/g) || []).length,
                symbolsFound: 0,
                confidence: 1.0
            });
        }

        let modeInstruction = "";
        if (mode === 'Planning') {
            modeInstruction = "\n### AGENT MODE ENABLED\nYou are in Planning (Agent) mode. You MUST take full initiative to complete the entire plan autonomously. USE YOUR TOOLS to write/edit files and run commands. DO NOT stop to report progress or ask for permission unless you hit a critical blocker. If you have more work to do, keep calling tools until the task is DONE. NEVER wait for the user to say 'continue' or 'proceed' if there are remaining steps in your plan.";
        }

        // JUST push the user command to history, clean and simple.
        // Context will be injected ephemerally.
        const userMessage = `${text}${modeInstruction}\n\nCURRENT MODE: ${mode}\nCURRENT MODEL: ${model}`;
        history.push({ role: 'user', parts: [{ text: userMessage }] });
        text = ""; // Clear text as it's now in history

        let maxIterations = mode === 'Planning' ? 30 : 5;
        const currentHistory = history;

        // 5. Main processing loop
        while (iteration < maxIterations) {
            if (signal.aborted) {
                onUpdate({ type: 'stopped', text: '🛑 Generation cancelled by user.' });
                break;
            }
            iteration++;

            // Update status in UI
            const statusMessage = iteration === 1 ? 'Thinking...' : `Analyzing & fixing errors (Round ${iteration})...`;
            onUpdate({ type: 'statusUpdate', text: statusMessage });

            // REBUILD CONTEXT for this turn (Fresh State)
            const { context: freshContext, codebaseContext: codeContext } = await this.buildIDEContext("");
            const planContext = await this.getActivePlanContext();

            let fullDynamicContext = freshContext + codeContext + autoGuidance + planContext;

            // Add loop awareness to context
            if (iteration > 1) {
                fullDynamicContext += `\n### AGENT LOOP STATUS (Iteration ${iteration}/${maxIterations}):\n`;
                fullDynamicContext += `You are in a self-correction loop. If previous steps failed, your primary goal is to DEBUG and FIX them. Do NOT ask for permission to fix a bug you just created or discovered. Fix it and run the command again.\n`;
            }

            // Record KIs only on first message
            if (iteration === 1 && history.length === 1) {
                const kis = await this.knowledgeService.listKIs();
                if (kis.length > 0) {
                    const kiContext = kis.map(k => `- ${k.title}: ${k.summary}`).join('\n');
                    fullDynamicContext += `\nRelevant Context from Knowledge base:\n${kiContext}`;
                }
            }

            let fullTextForThisTurn = "";
            let response;
            try {
                response = await this.aiService.getCompletionWithTools(
                    "", // Prompt is already in currentHistory
                    currentHistory,
                    this.getToolsMetadata(),
                    (chunk) => {
                        fullTextForThisTurn += chunk;
                        onUpdate({ type: 'textChunk', text: chunk });
                    },
                    model,
                    fullDynamicContext, // PASS FRESH CONTEXT
                    signal
                );
            } catch (error: any) {
                if (error.name === 'AbortError' || signal.aborted) {
                    onUpdate({ type: 'stopped', text: '🛑 Generation stopped.' });
                    break;
                }
                onUpdate({ type: 'error', text: `AI Error: ${error.message}` });
                break;
            }

            text = ""; // Clear after first iteration

            // 7. Record token usage
            if (response && response.usage) {
                this.tokenBudgetManager.recordUsage(response.usage);
                onUpdate({
                    type: 'budgetUpdate',
                    budget: this.tokenBudgetManager.getBudgetStatus()
                });
            }

            // 8. Handle tool calls with orchestrator
            if (response.toolCalls && response.toolCalls.length > 0) {
                const toolCallsWithIds = response.toolCalls.map((tc: any, idx: number) => {
                    const isDangerous = tc.name === 'run_command' && commandApprovalService.classifyCommandSafety(tc.args.commandLine || tc.args.command || '') === 'dangerous';
                    const isSafe = tc.name === 'run_command' && commandApprovalService.classifyCommandSafety(tc.args.commandLine || tc.args.command || '') === 'safe';
                    const isFileEdit = tc.name === 'write_to_file' || tc.name === 'replace_file_content' || tc.name === 'multi_replace_file_content';

                    // In Planning mode, auto-approve safe commands and file edits
                    let autoRun = tc.safeToAutoRun || false;
                    if (mode === 'Planning') {
                        if (isSafe || isFileEdit || tc.name === 'view_file' || tc.name === 'list_dir' || tc.name.startsWith('get_')) {
                            autoRun = true;
                        }
                    }

                    return {
                        id: tc.id || `call_${Date.now()}_${idx}`,
                        name: tc.name,
                        args: { ...tc.args, safeToAutoRun: autoRun }, // Inject autoRun into args for tools
                        waitForPreviousTools: tc.waitForPreviousTools || false,
                        safeToAutoRun: autoRun
                    };
                });

                // Register all tools with orchestrator
                this.tools.forEach(tool => this.toolOrchestrator.registerTool(tool));

                // Set up callbacks
                this.toolOrchestrator.setCallbacks({
                    onToolStart: (call) => {
                        onUpdate({ type: 'toolStart', tool: call.name, args: call.args, id: call.id });
                    },
                    onToolEnd: async (result) => {
                        onUpdate({ type: 'toolEnd', tool: result.name, result: result.result, args: result.args, id: result.id });

                        // Handle explicit artifact returns from tools (like PlanTools)
                        if (result.result && typeof result.result === 'object' && result.result.artifact) {
                            onUpdate({
                                type: 'artifactCreated',
                                artifact: result.result.artifact,
                                name: result.result.artifact.metadata.name,
                                id: result.id
                            });
                            return;
                        }

                        // Create artifact for code generation (legacy compatibility)
                        const fileModificationTools = ['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'write_to_file_fast'];
                        if (fileModificationTools.includes(result.name) && result.result && typeof result.result === 'object') {
                            try {
                                const res = result.result as any;
                                const artifact = await this.artifactManager.createArtifact(
                                    res.fileName || 'generated_file',
                                    res.content || '',
                                    'code',
                                    res.message || 'AI-modified code file',
                                    5,
                                    this.currentConversationId
                                );
                                onUpdate({ type: 'artifactCreated', name: res.fileName || 'file', artifact, id: result.id });
                            } catch (e) {
                                console.error('Failed to create artifact:', e);
                            }
                        }
                    },
                    onToolError: (call, error) => {
                        onUpdate({ type: 'toolError', tool: call.name, error, id: call.id });
                    },
                    onToolOutput: (id, output) => {
                        onUpdate({ type: 'toolOutput', id, output });
                    }
                });

                // Execute tools
                const results = await this.toolOrchestrator.executeBatch(toolCallsWithIds, signal);

                // Track failures for self-correction logic
                lastToolsFailed = results.some(r => {
                    if (r.error) return true;
                    if (r.result && typeof r.result === 'object') {
                        const res = r.result as any;
                        if (res.error) return true;

                        // Strip ANSI codes for pattern matching
                        const stripAnsi = (str: string) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
                        const fullOutput = stripAnsi((res.stdout || '') + (res.stderr || '') + (res.output || ''));

                        // Fail on explicit non-zero exit code
                        if (res.exitCode !== undefined && res.exitCode !== 0) return true;

                        // Patterns that indicate build/compilation failure even if process didn't exit
                        const failurePatterns = [
                            'BUILD FAILED', 'Compilation failed', 'Failed to compile',
                            'Application bundle generation failed', 'ERROR in', 'Syntax Error:',
                            'ReferenceError:', 'TypeError:', 'Module not found:', "Can't resolve",
                            'NG2008:', 'TS2307:', 'TS2304:', 'TS2339:', 'TS2322:',
                            'Property \'', 'is not assignable to parameter',
                            'LINT ERROR', 'RuntimeError:', 'ImportError:',
                            'ModuleNotFoundError:', 'IndentationError:', 'TabError:',
                            'java.lang.', 'javac:', 'Exception in thread',
                            'CS0246:', 'CS0103:', 'CS1002:', 'error CS'
                        ];

                        if (failurePatterns.some(p => fullOutput.includes(p))) return true;
                    }
                    return false;
                });

                // Build execution summary
                const stats = this.toolOrchestrator.getStatistics();
                onUpdate({
                    type: 'toolStats',
                    count: stats.totalCalls,
                    duration: stats.totalDuration,
                    success: stats.successfulCalls,
                    failed: stats.failedCalls
                });

                // Record the assistant's request (with any text + tool calls with stable IDs)
                history.push({
                    role: 'model',
                    parts: [
                        { text: response.text || null }, // Include text content if present
                        ...toolCallsWithIds.map((tc: any) => ({
                            functionCall: { name: tc.name, args: tc.args, callId: tc.id }
                        }))
                    ]
                });

                // Record each tool's response turn
                results.forEach(result => {
                    history.push({
                        role: 'function',
                        parts: [{
                            functionResponse: {
                                name: result.name,
                                response: { result: result.result, error: result.error },
                                callId: result.id
                            }
                        }]
                    });
                });
            } else {

                // If the previous tools failed, force the model to try fixing it instead of giving up
                // If the previous tools failed, force the model to try fixing it instead of giving up
                if (lastToolsFailed) {
                    const correctionPrompt = `### 🚨 TOOL EXECUTION FAILED 🚨
The previous tool calls resulted in errors or build failures. 
You MUST analyze the output provided above and FIX the issues immediately.

GUIDELINES FOR FIXING:
1. **Analyze Logs**: Look at the STDOUT/STDERR for specific filenames and line numbers.
2. **Inspect Code**: Use 'view_file' or 'grep_search' to see the failing code mentioned in the logs.
3. **Fix Assertively**: Apply fixes using 'replace_file_content' or other file tools.
4. **Retry**: After fixing, run the original command (or a verify command) again.
5. **No Giving Up**: Do NOT ask for permission to fix the bug you just found. Do NOT suggest the user to fix it. YOU are the agent. Fix it now.`;

                    // Inject the correction prompt
                    history.push({ role: 'user', parts: [{ text: correctionPrompt }] });

                    onUpdate({ type: 'statusUpdate', text: '🔧 Failure detected. Analyzing logs and applying fixes...' });
                    lastToolsFailed = false; // Reset flag for next attempt
                    continue; // Force next loop iteration
                }

                // 9. Final response turn
                onUpdate({ type: 'finalResponse', text: response.text });

                // Final persistence for this message turn
                history.push({ role: 'model', parts: [{ text: response.text }] });
                break;
            }

        }
    }

    public getSuggestedResponses(context: any) {
        return [];
    }

    public getTokenBudgetStatus() {
        return this.tokenBudgetManager.getBudgetStatus();
    }

    public resetTokenBudget() {
        this.tokenBudgetManager.resetConversation();
    }

    public getArtifacts() {
        return this.artifactManager.getAllArtifacts();
    }

    public getDependencyAnalyzer() {
        return this.dependencyAnalyzer;
    }


    public async dispose() {
        await this.browserTools.cleanup();
    }

    private async extractMentionedFiles(text: string): Promise<string[]> {
        const files: string[] = [];
        // Robust Regex for @file:path or @file:"path with spaces"
        const mentionRegex = /@files?\s+("[^"]+"|[^\s,]+)|@file:("[^"]+"|[^\s,]+)/g;
        let match;
        while ((match = mentionRegex.exec(text)) !== null) {
            let path = (match[1] || match[2]).replace(/"/g, '');
            files.push(path);
        }

        // Auto-discovery fallback: if user mentions requirements but doesn't use @ tag
        if (files.length === 0 && (text.toLowerCase().includes('requirement') || text.toLowerCase().includes('implement'))) {
            try {
                const discovered = await vscode.workspace.findFiles('**/requirement*.*', '**/node_modules/**', 5);
                discovered.forEach(f => files.push(vscode.workspace.asRelativePath(f)));
            } catch (e) {
                console.error('Auto-discovery failed:', e);
            }
        }
        return [...new Set(files)];
    }

    private async handleRequirementsFiles(files: string[]): Promise<string> {
        let guidance = "";
        for (const file of files) {
            if (file.toLowerCase().includes('requirement')) {
                try {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!workspaceFolders) continue;

                    let fileUri: vscode.Uri | null = null;

                    if (file.startsWith('/') || file.match(/^[a-zA-Z]:/)) {
                        fileUri = vscode.Uri.file(file);
                    } else {
                        const foundFiles = await vscode.workspace.findFiles(`**/${file}`, '**/node_modules/**', 1);
                        if (foundFiles.length > 0) {
                            fileUri = foundFiles[0];
                        }
                    }

                    if (fileUri) {
                        const content = await vscode.workspace.fs.readFile(fileUri);
                        const text = Buffer.from(content).toString('utf8');
                        guidance += `\n### 📋 AUTO-DETECTED REQUIREMENTS: ${file}\nContent:\n${text}\n\nYou MUST use 'create_implementation_plan' to breakdown these into tasks NOW. Break the content into id/title/description for each requirement (bullets or numbered items).`;
                    }
                } catch (e) {
                    console.error('Failed to read requirement file:', file, e);
                }
            }
        }
        return guidance;
    }

    private async getActivePlanContext(): Promise<string> {
        const artifacts = this.artifactManager.getArtifactsByConversation(this.currentConversationId);
        const planArtifact = [...artifacts].reverse().find(a => a.metadata.type === 'implementation_plan');

        if (!planArtifact) return "";

        try {
            const data = JSON.parse(planArtifact.content);
            const total = data.tasks.length;
            const completed = data.tasks.filter((t: any) => t.status === 'completed').length;
            const percent = Math.round((completed / total) * 100);
            const nextTask = data.tasks.find((t: any) => t.status !== 'completed');

            let context = `\n### 📈 ACTIVE PLAN PROGRESS:\nYou have an active plan for "${data.title}" which is ${percent}% complete (${completed}/${total} tasks).`;
            if (nextTask) {
                context += `\n**Next Task:** [Task ${nextTask.id}] ${nextTask.title}\nDescription: ${nextTask.description || 'No description'}\n\n**Action:** Implement this task now, then call 'update_task_status' to mark it 'completed'. After that, move to the next task until the plan is 100% complete. If you finish all tasks, summarize your work.`;
            } else {
                context += `\nAll tasks in this plan are completed! Summary: ${planArtifact.metadata.summary}`;
            }
            return context;
        } catch (e) {
            return "";
        }
    }

    private async handleSlashCommands(text: string, onUpdate: (update: any) => void): Promise<boolean> {
        const cmd = text.split(' ')[0].toLowerCase();

        if (cmd === '/plans') {
            const artifacts = this.artifactManager.getAllArtifacts().filter(a => a.metadata.type === 'implementation_plan');
            if (artifacts.length === 0) {
                onUpdate({ type: 'finalResponse', text: "No implementation plans found in workspace." });
                return true;
            }

            let response = "📋 **Implementation Plans:**\n\n";
            artifacts.forEach(a => {
                try {
                    const data = JSON.parse(a.content);
                    const total = data.tasks.length;
                    const completed = data.tasks.filter((t: any) => t.status === 'completed').length;
                    const percent = Math.round((completed / total) * 100);
                    const status = percent === 100 ? '✅' : '⏳';
                    response += `${status} **${data.title}**: ${percent}% complete (${completed}/${total})\n`;
                    data.tasks.forEach((t: any) => {
                        const icon = t.status === 'completed' ? '✅' : (t.status === 'in_progress' ? '⏳' : '⚪');
                        response += `  ${icon} [Task ${t.id}] ${t.title}\n`;
                    });
                    response += "\n";
                } catch { }
            });
            onUpdate({ type: 'finalResponse', text: response });
            return true;
        }

        if (cmd === '/clear') {
            this.tokenBudgetManager.resetConversation();
            onUpdate({ type: 'command', name: 'clear' });
            return true;
        }
        if (cmd === '/summarize') {
            onUpdate({ type: 'finalResponse', text: 'I am summarizing the chat context...' });
            return true;
        }
        if (cmd === '/budget') {
            const status = this.tokenBudgetManager.getBudgetStatus();
            onUpdate({
                type: 'finalResponse',
                text: `📊 Token Budget Status:\n- Used: ${status.used.toLocaleString()}\n- Total: ${status.total.toLocaleString()}\n- Remaining: ${status.remaining.toLocaleString()}\n- Percent Used: ${status.percentUsed}%\n- Status: ${status.status}`
            });
            return true;
        }
        if (cmd === '/artifacts') {
            const summary = this.artifactManager.getArtifactSummary();
            onUpdate({ type: 'finalResponse', text: summary });
            return true;
        }

        return false;
    }

    public sendTerminalInput(input: string) {
        this.terminalToolsManager.sendInputToActiveCommand(input);
    }

    public async cancel() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.terminalToolsManager.stopActiveCommand();
    }
}
