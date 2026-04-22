import * as vscode from 'vscode';

export interface CommandApprovalRequest {
    command: string;
    cwd: string;
    safeToAutoRun: boolean;
    description?: string;
}

export interface CommandApprovalProvider {
    requestApproval(request: CommandApprovalRequest, isDangerous: boolean): Promise<boolean>;
}

export class CommandApprovalService {
    private provider: CommandApprovalProvider | null = null;
    private pendingApprovals: Map<string, {
        request: CommandApprovalRequest;
        resolve: (approved: boolean) => void;
        reject: (reason: any) => void;
    }> = new Map();

    public setProvider(provider: CommandApprovalProvider) {
        this.provider = provider;
    }

    /**
     * Request approval for a command execution
     * @param request The command approval request
     * @returns Promise that resolves to true if approved, false if rejected
     */
    async requestApproval(request: CommandApprovalRequest): Promise<boolean> {
        // If marked as safe to auto-run, approve immediately
        if (request.safeToAutoRun) {
            return true;
        }

        const isDangerous = this.isDangerousCommand(request.command);

        // Check global setting for non-dangerous commands
        if (!isDangerous) {
            const autoExecute = vscode.workspace.getConfiguration('cnx').get<boolean>('autoExecuteSafeCommands', false);
            if (autoExecute) {
                return true;
            }
        }

        // Use custom provider if available (e.g. ChatPanel for inline buttons)
        if (this.provider) {
            return this.provider.requestApproval(request, isDangerous);
        }

        // Fallback to native dialog
        return this.showApprovalDialog(request, isDangerous);
    }


    /**
     * Check if a command matches dangerous patterns
     */
    private isDangerousCommand(command: string): boolean {
        const dangerousPatterns = [
            /rm\s+-rf/i,
            /del\s+\/[sS]/i,
            /format\s+/i,
            /mkfs/i,
            /dd\s+if=/i,
            />\s*\/dev\//i,
            /curl.*\|\s*bash/i,
            /wget.*\|\s*sh/i,
            /npm\s+install\s+-g/i,
            /pip\s+install/i,
            /apt-get\s+install/i,
            /yum\s+install/i,
            /docker\s+run/i,
            /kubectl\s+delete/i,
            /git\s+push\s+--force/i,
            /drop\s+database/i,
            /truncate\s+table/i
        ];

        return dangerousPatterns.some(pattern => pattern.test(command));
    }

    /**
     * Show approval dialog to user
     */
    private async showApprovalDialog(request: CommandApprovalRequest, isDangerous: boolean): Promise<boolean> {
        const warningIcon = isDangerous ? '⚠️ ' : '';
        const message = isDangerous
            ? `${warningIcon}DANGEROUS COMMAND DETECTED!\n\nThe AI wants to execute:\n\n${request.command}\n\nWorking directory: ${request.cwd}\n\nThis command could have destructive side effects. Are you sure you want to proceed?`
            : `The AI wants to execute:\n\n${request.command}\n\nWorking directory: ${request.cwd}\n\nDo you want to allow this?`;

        const options = isDangerous
            ? ['Cancel', 'Execute Anyway']
            : ['Approve', 'Reject', 'Always Approve Safe Commands'];

        const result = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            ...options
        );

        if (result === 'Approve' || result === 'Execute Anyway') {
            return true;
        } else if (result === 'Always Approve Safe Commands') {
            // Update settings to auto-approve safe commands
            await vscode.workspace.getConfiguration('cnx').update(
                'autoExecuteSafeCommands',
                true,
                vscode.ConfigurationTarget.Global
            );
            return true;
        }

        return false;
    }

    /**
     * Classify command safety level
     */
    classifyCommandSafety(command: string): 'safe' | 'moderate' | 'dangerous' {
        if (this.isDangerousCommand(command)) {
            return 'dangerous';
        }

        // Read-only commands are safe
        const safePatterns = [
            /^ls\s/i,
            /^dir\s/i,
            /^cat\s/i,
            /^type\s/i,
            /^echo\s/i,
            /^pwd$/i,
            /^cd\s/i,
            /^git\s+status/i,
            /^git\s+log/i,
            /^git\s+diff/i,
            /^npm\s+list/i,
            /^node\s+--version/i,
            /^python\s+--version/i
        ];

        if (safePatterns.some(pattern => pattern.test(command))) {
            return 'safe';
        }

        return 'moderate';
    }

    /**
     * Get approval status message
     */
    getApprovalStatusMessage(approved: boolean, command: string): string {
        if (approved) {
            return `✅ Command approved: ${command}`;
        } else {
            return `❌ Command rejected by user: ${command}`;
        }
    }
}

export const commandApprovalService = new CommandApprovalService();
