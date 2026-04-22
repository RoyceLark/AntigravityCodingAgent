import * as vscode from 'vscode';

export type DevelopmentMode = 'autopilot' | 'review' | 'assisted';

export interface ModeConfig {
    mode: DevelopmentMode;
    displayName: string;
    description: string;
    autoExecuteSafeCommands: boolean;
    autoExecuteFileEdits: boolean;
    autoExecuteDangerousCommands: boolean;
    requirePlanApproval: boolean;
    autoRunTests: boolean;
    autoFixErrors: boolean;
    maxAutonomousIterations: number;
}

export class DevelopmentModeService {
    private currentMode: DevelopmentMode = 'assisted';
    private modeConfigs: Map<DevelopmentMode, ModeConfig>;
    private modeChangeEmitter: vscode.EventEmitter<ModeConfig>;
    public onModeChange: vscode.Event<ModeConfig>;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.modeChangeEmitter = new vscode.EventEmitter<ModeConfig>();
        this.onModeChange = this.modeChangeEmitter.event;

        // Initialize mode configurations
        this.modeConfigs = new Map([
            [
                'autopilot',
                {
                    mode: 'autopilot',
                    displayName: 'Autopilot',
                    description: 'Agent operates fully autonomously. All actions execute automatically.',
                    autoExecuteSafeCommands: true,
                    autoExecuteFileEdits: true,
                    autoExecuteDangerousCommands: true,
                    requirePlanApproval: false,
                    autoRunTests: true,
                    autoFixErrors: true,
                    maxAutonomousIterations: 30,
                },
            ],
            [
                'review',
                {
                    mode: 'review',
                    displayName: 'Review',
                    description: 'Agent asks for approval before almost any action. Maximum control.',
                    autoExecuteSafeCommands: false,
                    autoExecuteFileEdits: false,
                    autoExecuteDangerousCommands: false,
                    requirePlanApproval: true,
                    autoRunTests: false,
                    autoFixErrors: false,
                    maxAutonomousIterations: 5,
                },
            ],
            [
                'assisted',
                {
                    mode: 'assisted',
                    displayName: 'Assisted',
                    description: 'Balanced mode. Safe commands auto-execute, dangerous actions need approval.',
                    autoExecuteSafeCommands: true,
                    autoExecuteFileEdits: true,
                    autoExecuteDangerousCommands: false,
                    requirePlanApproval: true,
                    autoRunTests: true,
                    autoFixErrors: true,
                    maxAutonomousIterations: 15,
                },
            ],
        ]);

        // Load the saved mode from configuration
        this.loadModeFromConfiguration();
    }

    /**
     * Load the current development mode from workspace configuration
     */
    private loadModeFromConfiguration(): void {
        const config = vscode.workspace.getConfiguration('cnx');
        const savedMode = config.get<DevelopmentMode>('developmentMode', 'assisted');

        if (this.modeConfigs.has(savedMode)) {
            this.currentMode = savedMode;
        } else {
            this.currentMode = 'assisted';
        }
    }

    /**
     * Get the current development mode configuration
     */
    public getCurrentMode(): ModeConfig {
        const mode = this.modeConfigs.get(this.currentMode);
        if (!mode) {
            throw new Error(`Unknown development mode: ${this.currentMode}`);
        }
        return mode;
    }

    /**
     * Set the current development mode and persist to configuration
     */
    public async setMode(mode: DevelopmentMode): Promise<void> {
        if (!this.modeConfigs.has(mode)) {
            throw new Error(`Unknown development mode: ${mode}`);
        }

        this.currentMode = mode;

        // Persist to workspace configuration
        const config = vscode.workspace.getConfiguration('cnx');
        await config.update('developmentMode', mode, vscode.ConfigurationTarget.Workspace);

        // Emit change event
        const modeConfig = this.getCurrentMode();
        this.modeChangeEmitter.fire(modeConfig);

        // Show notification
        vscode.window.showInformationMessage(
            `Development mode changed to: ${modeConfig.displayName}`,
            'View Details'
        );
    }

    /**
     * Get configuration for a specific mode
     */
    public getModeConfig(mode: DevelopmentMode): ModeConfig {
        const config = this.modeConfigs.get(mode);
        if (!config) {
            throw new Error(`Unknown development mode: ${mode}`);
        }
        return config;
    }

    /**
     * Get all available modes
     */
    public getAllModes(): ModeConfig[] {
        return Array.from(this.modeConfigs.values());
    }

    /**
     * Determine if a specific action type should auto-execute based on current mode
     */
    public shouldAutoExecute(
        actionType: 'safe_command' | 'dangerous_command' | 'file_edit' | 'plan' | 'test' | 'error_fix'
    ): boolean {
        const config = this.getCurrentMode();

        switch (actionType) {
            case 'safe_command':
                return config.autoExecuteSafeCommands;
            case 'dangerous_command':
                return config.autoExecuteDangerousCommands;
            case 'file_edit':
                return config.autoExecuteFileEdits;
            case 'plan':
                return !config.requirePlanApproval;
            case 'test':
                return config.autoRunTests;
            case 'error_fix':
                return config.autoFixErrors;
            default:
                return false;
        }
    }

    /**
     * Get the current mode name
     */
    public getCurrentModeName(): DevelopmentMode {
        return this.currentMode;
    }

    /**
     * Get a human-readable description of current mode's autonomy level
     */
    public getAutonomyDescription(): string {
        const config = this.getCurrentMode();
        return config.description;
    }

    /**
     * Dispose of event emitters
     */
    public dispose(): void {
        this.modeChangeEmitter.dispose();
    }
}
