import * as vscode from 'vscode';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { commandApprovalService } from '../services/CommandApprovalService';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export class TerminalToolsManager {
    private processes: Map<string, { process: ChildProcess, output: string[], command?: string }> = new Map();
    private static outputChannel: vscode.OutputChannel;
    private commandHistory: { command: string, status: string, exitCode?: number | null, timestamp: number }[] = [];
    private activeForegroundProcess: ChildProcess | null = null;

    constructor() {
        if (!TerminalToolsManager.outputChannel) {
            TerminalToolsManager.outputChannel = vscode.window.createOutputChannel('Cnx Agent Terminal');
        }
    }

    public getCommandHistory() {
        return this.commandHistory;
    }

    private addToHistory(command: string, status: string, exitCode?: number | null) {
        this.commandHistory.push({
            command,
            status,
            exitCode,
            timestamp: Date.now()
        });
        // Keep last 10 commands
        if (this.commandHistory.length > 10) {
            this.commandHistory.shift();
        }
    }

    public getTools() {
        return {
            run_command: {
                name: 'run_command',
                description: 'Execute a command in the terminal',
                parameters: {
                    type: 'object',
                    properties: {
                        commandLine: { type: 'string' },
                        cwd: { type: 'string' },
                        isBackground: { type: 'boolean', description: 'Run in background' },
                        safeToAutoRun: { type: 'boolean', description: 'Whether command is safe to auto-run' },
                        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 600000)' },
                        earlyResolvePatterns: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Patterns that, if seen in output, cause the tool to return immediately even if the process continues (e.g., "Build successful")'
                        }
                    },
                    required: ['commandLine', 'cwd']
                },
                execute: async (args: { commandLine: string, cwd: string, isBackground?: boolean, safeToAutoRun?: boolean, timeout?: number, earlyResolvePatterns?: string[] }, onOutput?: (output: string) => void) => {
                    // Request approval for command execution
                    const approved = await commandApprovalService.requestApproval({
                        command: args.commandLine,
                        cwd: args.cwd,
                        safeToAutoRun: args.safeToAutoRun || false
                    });

                    if (!approved) {
                        return '❌ Command execution cancelled by user';
                    }

                    const shell = process.env.ComSpec || 'cmd.exe';

                    try {
                        await fs.access(args.cwd);
                    } catch {
                        return { error: `CWD does not exist: ${args.cwd}. Please ensure you use absolute paths in the current project.` };
                    }

                    TerminalToolsManager.outputChannel.show(true);
                    TerminalToolsManager.outputChannel.appendLine(`\n> ${args.commandLine} (in ${args.cwd})\n`);

                    if (args.isBackground) {
                        const id = Math.random().toString(36).substring(7);
                        const child = spawn(args.commandLine, {
                            cwd: args.cwd,
                            shell: shell,
                            env: process.env
                        });
                        const output: string[] = [];

                        this.addToHistory(args.commandLine, 'running');

                        child.stdout?.on('data', (data) => {
                            const str = data.toString();
                            output.push(str);
                            if (output.length > 1000) output.shift(); // robustness: prevent memory leaks
                            TerminalToolsManager.outputChannel.append(str);
                        });
                        child.stderr?.on('data', (data) => {
                            const str = data.toString();
                            output.push(str);
                            if (output.length > 1000) output.shift();
                            TerminalToolsManager.outputChannel.append(str);
                        });

                        this.processes.set(id, { process: child, output, command: args.commandLine });
                        return { id, status: 'running' };
                    }

                    return new Promise((resolve) => {
                        const child = spawn(args.commandLine, {
                            cwd: args.cwd,
                            shell: true, // Better for Windows command discovery (npm.cmd, etc)
                            env: process.env
                        });

                        let stdout = '';
                        let stderr = '';
                        let isResolved = false;
                        const timeoutMs = args.timeout || 600000;
                        let lastOutputTime = Date.now();

                        // Common interactive prompts to watch for
                        const interactivePatterns = [
                            '?', 'y/n', 'yes/no', '[y/N]', '[Y/n]', 'password:',
                            'enter passphrase', 'choice:', 'continue?'
                        ];

                        const timer = setTimeout(() => {
                            if (!isResolved) {
                                isResolved = true;
                                child.kill();
                                this.addToHistory(args.commandLine, 'timeout', -1);
                                resolve({ error: `Command execution timed out after ${timeoutMs}ms`, stdout, stderr: stderr + '\n[Timeout]' });
                            }
                        }, timeoutMs);

                        // Silence detection timer
                        const silenceInterval = setInterval(() => {
                            if (isResolved) {
                                clearInterval(silenceInterval);
                                return;
                            }
                            const idleTime = Date.now() - lastOutputTime;
                            if (idleTime > 30000) { // 30 seconds of silence
                                if (onOutput) onOutput(`\n[System: Command is still running... (no output for 30s). Is it waiting for input?]\n`);
                            }
                        }, 30000);

                        const checkPatterns = (data: string) => {
                            lastOutputTime = Date.now();

                            // Check for early resolve patterns
                            if (args.earlyResolvePatterns && !isResolved) {
                                for (const pattern of args.earlyResolvePatterns) {
                                    if (data.includes(pattern)) {
                                        isResolved = true;
                                        clearTimeout(timer);
                                        clearInterval(silenceInterval);
                                        this.addToHistory(args.commandLine, 'early_resolve', 0);
                                        resolve({ stdout, stderr, status: 'early_resolve', pattern });
                                        return;
                                    }
                                }
                            }

                            // Check for interactive prompts
                            const lowerData = data.toLowerCase();
                            if (interactivePatterns.some(p => lowerData.includes(p))) {
                                if (onOutput) onOutput(`\n[System: Potential interactive prompt detected. You may need to click "Continue" (Send Enter) or check the terminal.]\n`);
                            }
                        };

                        child.stdout?.on('data', (data) => {
                            const str = data.toString();
                            stdout += str;
                            TerminalToolsManager.outputChannel.append(str);
                            if (onOutput) onOutput(str);
                            checkPatterns(str);
                        });

                        child.stderr?.on('data', (data) => {
                            const str = data.toString();
                            stderr += str;
                            TerminalToolsManager.outputChannel.append(str);
                            if (onOutput) onOutput(str);
                            checkPatterns(str);
                        });

                        child.on('error', (error) => {
                            if (isResolved) return;
                            isResolved = true;
                            clearTimeout(timer);
                            clearInterval(silenceInterval);
                            this.addToHistory(args.commandLine, 'error', -1);
                            resolve({ error: error.message, stdout, stderr });
                        });

                        child.on('close', (code) => {
                            if (isResolved) return;
                            isResolved = true;
                            if (this.activeForegroundProcess === child) {
                                this.activeForegroundProcess = null;
                            }
                            clearTimeout(timer);
                            clearInterval(silenceInterval);
                            this.addToHistory(args.commandLine, code === 0 ? 'success' : 'failed', code);
                            if (code === 0) {
                                resolve({ stdout, stderr });
                            } else {
                                resolve({ error: `Command failed with exit code ${code}`, stdout, stderr });
                            }
                        });

                        this.activeForegroundProcess = child;
                    });
                }
            },
            command_status: {
                name: 'command_status',
                description: 'Check the status of a background command',
                parameters: {
                    type: 'object',
                    properties: { commandId: { type: 'string' } },
                    required: ['commandId']
                },
                execute: async (args: { commandId: string }) => {
                    const proc = this.processes.get(args.commandId);
                    if (!proc) return { error: 'Command not found' };
                    return {
                        status: proc.process.exitCode === null ? 'running' : 'done',
                        exitCode: proc.process.exitCode,
                        output: proc.output.join('')
                    };
                }
            },
            send_command_input: {
                name: 'send_command_input',
                description: 'Send input to a running command',
                parameters: {
                    type: 'object',
                    properties: {
                        commandId: { type: 'string' },
                        input: { type: 'string' }
                    },
                    required: ['commandId', 'input']
                },
                execute: async (args: { commandId: string, input: string }) => {
                    const proc = this.processes.get(args.commandId);
                    if (!proc || !proc.process.stdin) return { error: 'Command or stdin not found' };
                    proc.process.stdin.write(args.input + '\n');
                    return 'Input sent';
                }
            },

            list_background_processes: {
                name: 'list_background_processes',
                description: 'List all currently running background commands',
                parameters: { type: 'object', properties: {} },
                execute: async () => {
                    const active = [];
                    for (const [id, proc] of this.processes.entries()) {
                        if (proc.process.exitCode === null) {
                            active.push({ id, command: (proc as any).command || 'Unknown' });
                        }
                    }
                    return active;
                }
            },

            get_terminal_output: {
                name: 'get_terminal_output',
                description: 'Get the last N lines of output from a background process (tail)',
                parameters: {
                    type: 'object',
                    properties: {
                        commandId: { type: 'string' },
                        lines: { type: 'number', description: 'Number of lines to return' }
                    },
                    required: ['commandId']
                },
                execute: async (args: { commandId: string, lines?: number }) => {
                    const proc = this.processes.get(args.commandId);
                    if (!proc) return { error: 'Process not found' };

                    const limit = args.lines || 50;
                    const output = proc.output.join('').split('\n');
                    return output.slice(-limit).join('\n');
                }
            }
        };
    }

    public sendInputToActiveCommand(input: string) {
        if (this.activeForegroundProcess && this.activeForegroundProcess.stdin) {
            this.activeForegroundProcess.stdin.write(input + '\n');
            TerminalToolsManager.outputChannel.appendLine(`[USER INPUT]: ${input}`);
            return true;
        }
        return false;
    }

    public stopActiveCommand() {
        if (this.activeForegroundProcess) {
            this.activeForegroundProcess.kill();
            TerminalToolsManager.outputChannel.appendLine(`[PROCESS KILLED]: SIGTERM sent to foreground process`);
            this.activeForegroundProcess = null;
            return true;
        }
        return false;
    }
}
