import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export class GitService {
    /**
     * Get the current git branch
     */
    async getCurrentBranch(cwd: string): Promise<string> {
        try {
            const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
            return stdout.trim();
        } catch (e) {
            return 'unknown (no git)';
        }
    }

    /**
     * Get a summary of the current git status
     */
    async getStatusSummary(cwd: string): Promise<string> {
        try {
            const { stdout } = await execAsync('git status --short', { cwd });
            if (!stdout.trim()) return 'Clean';

            const lines = stdout.trim().split('\n');
            if (lines.length > 10) {
                return `${lines.slice(0, 10).join('\n')}\n... and ${lines.length - 10} more files.`;
            }
            return stdout.trim();
        } catch (e) {
            return 'Git not available';
        }
    }

    /**
     * Get the last N commit messages
     */
    async getRecentCommits(cwd: string, n: number = 3): Promise<string> {
        try {
            const { stdout } = await execAsync(`git log -n ${n} --oneline`, { cwd });
            return stdout.trim();
        } catch (e) {
            return 'No commits found';
        }
    }
}
