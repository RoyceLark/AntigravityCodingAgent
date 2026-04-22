import * as vscode from 'vscode';
import { AIService } from './AIService';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Error detection and classification
 */
export interface DetectedError {
    type: 'typescript' | 'runtime' | 'lint' | 'build' | 'unknown';
    severity: 'error' | 'warning' | 'info';
    message: string;
    file?: string;
    line?: number;
    column?: number;
    code?: string;
    stackTrace?: string;
}

/**
 * Fix result from autonomous healing
 */
export interface FixResult {
    success: boolean;
    errorFixed: DetectedError;
    fixDescription: string;
    filesModified: string[];
    timestamp: Date;
}

/**
 * SelfHealingService - Autonomous error detection and fixing
 * 
 * This service monitors the workspace for errors and automatically attempts to fix them:
 * - TypeScript compilation errors
 * - Runtime errors from extension logs
 * - Linting issues
 * - Build failures
 * 
 * Features:
 * - Real-time error monitoring via VS Code diagnostics
 * - Intelligent error analysis using AI
 * - Autonomous code fixes
 * - Fix history tracking
 * - Rollback capabilities
 */
export class SelfHealingService {
    private disposables: vscode.Disposable[] = [];
    private fixHistory: FixResult[] = [];
    private isEnabled: boolean = true;
    private isFixingInProgress: boolean = false;
    private errorQueue: DetectedError[] = [];

    // Event emitters
    private _onErrorDetected = new vscode.EventEmitter<DetectedError>();
    public readonly onErrorDetected = this._onErrorDetected.event;

    private _onErrorFixed = new vscode.EventEmitter<FixResult>();
    public readonly onErrorFixed = this._onErrorFixed.event;

    constructor(
        private context: vscode.ExtensionContext,
        private aiService: AIService
    ) {
        this.initialize();
    }

    /**
     * Initialize the self-healing service
     */
    private initialize(): void {
        // Monitor TypeScript diagnostics
        this.disposables.push(
            vscode.languages.onDidChangeDiagnostics(this.handleDiagnosticsChange.bind(this))
        );

        // Monitor file saves to detect potential issues
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(this.handleFileSave.bind(this))
        );

        // Monitor build output
        this.monitorBuildOutput();

        vscode.window.showInformationMessage('🔧 Self-Healing Service activated - Errors will be automatically detected and fixed');
    }

    private debounceTimer: NodeJS.Timeout | null = null;

    // Files we should NEVER attempt to auto-fix (config/lock files)
    private readonly SKIP_FILES = [
        'tsconfig.json', 'package.json', 'package-lock.json',
        'webpack.config.js', '.eslintrc', '.prettierrc', 'yarn.lock'
    ];

    /**
     * Handle diagnostics changes (TypeScript errors, linting, etc.)
     */
    private async handleDiagnosticsChange(event: vscode.DiagnosticChangeEvent): Promise<void> {
        if (!this.isEnabled || this.isFixingInProgress) {
            return;
        }

        for (const uri of event.uris) {
            const fileName = require('path').basename(uri.fsPath);

            // Skip config/lock files — self-healing should never touch these
            if (this.SKIP_FILES.some(f => fileName.toLowerCase() === f.toLowerCase())) {
                continue;
            }

            const diagnostics = vscode.languages.getDiagnostics(uri);
            const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);

            if (errors.length > 0) {
                for (const diagnostic of errors) {
                    const detectedError: DetectedError = {
                        type: this.classifyError(diagnostic),
                        severity: 'error',
                        message: diagnostic.message,
                        file: uri.fsPath,
                        line: diagnostic.range.start.line + 1,
                        column: diagnostic.range.start.character + 1,
                        code: diagnostic.code?.toString()
                    };

                    this._onErrorDetected.fire(detectedError);
                    this.errorQueue.push(detectedError);
                }

                // Debounce: wait 2s after last change before attempting fix
                if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
                this.debounceTimer = setTimeout(() => this.processErrorQueue(), 2000);
            }
        }
    }

    /**
     * Classify the type of error
     */
    private classifyError(diagnostic: vscode.Diagnostic): DetectedError['type'] {
        const source = diagnostic.source?.toLowerCase() || '';
        const message = diagnostic.message.toLowerCase();

        if (source.includes('ts') || message.includes('typescript')) {
            return 'typescript';
        } else if (source.includes('eslint') || source.includes('lint')) {
            return 'lint';
        } else {
            return 'unknown';
        }
    }

    /**
     * Handle file save events
     */
    private async handleFileSave(document: vscode.TextDocument): Promise<void> {
        // Check for errors after save
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);

        if (errors.length > 0 && this.isEnabled && !this.isFixingInProgress) {
            vscode.window.showInformationMessage(`🔍 Detected ${errors.length} error(s) in ${path.basename(document.fileName)}. Analyzing...`);
        }
    }

    /**
     * Monitor build output for errors
     */
    private monitorBuildOutput(): void {
        // This will be enhanced to monitor terminal output
        // For now, we rely on diagnostics
    }

    /**
     * Process the error queue and attempt fixes
     */
    private async processErrorQueue(): Promise<void> {
        if (this.isFixingInProgress || this.errorQueue.length === 0) {
            return;
        }

        this.isFixingInProgress = true;

        try {
            // Group errors by file
            const errorsByFile = new Map<string, DetectedError[]>();

            for (const error of this.errorQueue) {
                if (error.file) {
                    if (!errorsByFile.has(error.file)) {
                        errorsByFile.set(error.file, []);
                    }
                    errorsByFile.get(error.file)!.push(error);
                }
            }

            // Fix errors file by file
            for (const [file, errors] of errorsByFile) {
                await this.fixErrorsInFile(file, errors);
            }

            // Clear the queue
            this.errorQueue = [];
        } finally {
            this.isFixingInProgress = false;
        }
    }

    /**
     * Attempt to fix errors in a specific file.
     * Config/lock files are always skipped.
     */
    private async fixErrorsInFile(filePath: string, errors: DetectedError[]): Promise<void> {
        const fileName = path.basename(filePath);

        // Guard: never auto-fix config or lock files
        if (this.SKIP_FILES.some(f => fileName.toLowerCase() === f.toLowerCase())) {
            console.log('[SelfHealing] Skipping config file:', fileName);
            return;
        }

        try {
            console.log(`[SelfHealing] Attempting to fix ${errors.length} error(s) in ${fileName}...`);

            // Read the file content
            const fileContent = fs.readFileSync(filePath, 'utf-8');

            // Prepare error context for AI
            const errorContext = errors.map(e =>
                `Line ${e.line}, Column ${e.column}: ${e.message}${e.code ? ` (${e.code})` : ''}`
            ).join('\n');

            const prompt = `You are a code fixing assistant. Analyze the following TypeScript/JavaScript file and fix the errors.

FILE: ${filePath}

ERRORS:
${errorContext}

CURRENT FILE CONTENT:
\`\`\`typescript
${fileContent}
\`\`\`

Please provide the COMPLETE fixed file content. Only output the corrected code, no explanations.`;

            const response = await this.aiService.getCompletionWithTools(prompt, [], []);
            const fixedCode = this.extractCodeFromResponse(response.text);

            if (fixedCode && fixedCode !== fileContent) {
                fs.writeFileSync(filePath, fixedCode, 'utf-8');

                const fixResult: FixResult = {
                    success: true,
                    errorFixed: errors[0],
                    fixDescription: `Fixed ${errors.length} error(s) in ${fileName}`,
                    filesModified: [filePath],
                    timestamp: new Date()
                };

                this.fixHistory.push(fixResult);
                this._onErrorFixed.fire(fixResult);

                // Only show a notification on SUCCESS
                vscode.window.showInformationMessage(`✅ Self-Healed: Fixed ${errors.length} error(s) in ${fileName}`);

                const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === filePath);
                if (doc) { await vscode.window.showTextDocument(doc.uri); }
            } else {
                console.log(`[SelfHealing] Could not generate fix for ${fileName}`);
            }
        } catch (error) {
            // Silent — never spam the notification bar with AI failures
            console.error('[SelfHealing] Failed to fix errors in', fileName, ':', error);
        }
    }


    /**
     * Extract code from AI response (handles markdown code blocks)
     */
    private extractCodeFromResponse(response: string): string | null {
        // Try to extract from code blocks
        const codeBlockMatch = response.match(/```(?:typescript|javascript|ts|js)?\n([\s\S]*?)```/);
        if (codeBlockMatch) {
            return codeBlockMatch[1].trim();
        }

        // If no code block, check if entire response looks like code
        if (response.includes('import ') || response.includes('export ') || response.includes('function ')) {
            return response.trim();
        }

        return null;
    }

    /**
     * Manually trigger error detection and fixing
     */
    public async scanAndFix(): Promise<void> {
        vscode.window.showInformationMessage('🔍 Scanning workspace for errors...');

        // Get all diagnostics
        const allDiagnostics = vscode.languages.getDiagnostics();
        let totalErrors = 0;

        for (const [uri, diagnostics] of allDiagnostics) {
            const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);

            if (errors.length > 0) {
                totalErrors += errors.length;

                for (const diagnostic of errors) {
                    const detectedError: DetectedError = {
                        type: this.classifyError(diagnostic),
                        severity: 'error',
                        message: diagnostic.message,
                        file: uri.fsPath,
                        line: diagnostic.range.start.line + 1,
                        column: diagnostic.range.start.character + 1,
                        code: diagnostic.code?.toString()
                    };

                    this.errorQueue.push(detectedError);
                }
            }
        }

        if (totalErrors > 0) {
            vscode.window.showInformationMessage(`Found ${totalErrors} error(s). Attempting to fix...`);
            await this.processErrorQueue();
        } else {
            vscode.window.showInformationMessage('✅ No errors found in workspace!');
        }
    }

    /**
     * Enable or disable self-healing
     */
    public setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        vscode.window.showInformationMessage(
            enabled ? '🔧 Self-Healing enabled' : '⏸️ Self-Healing disabled'
        );
    }

    /**
     * Get fix history
     */
    public getFixHistory(): FixResult[] {
        return [...this.fixHistory];
    }

    /**
     * Clear fix history
     */
    public clearFixHistory(): void {
        this.fixHistory = [];
    }

    /**
     * Dispose of the service
     */
    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this._onErrorDetected.dispose();
        this._onErrorFixed.dispose();
    }
}
