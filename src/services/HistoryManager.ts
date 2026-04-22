import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export class HistoryManager {
    private historyDir: string | undefined;

    constructor(private context: vscode.ExtensionContext) {
        this.historyDir = path.join(context.globalStorageUri.fsPath, 'history');
    }


    private async ensureDir() {
        if (!this.historyDir) {
            console.error('HistoryManager: No history directory configured.');
            return;
        }
        try {
            await fs.mkdir(this.historyDir, { recursive: true });
        } catch (e: any) {
            console.error(`HistoryManager: Failed to create directory: ${e.message}`);
            vscode.window.showErrorMessage(`Failed to create history directory: ${e.message}`);
        }
    }


    public async saveHistory(conversationId: string, data: any) {
        if (!this.historyDir) return;
        try {
            await this.ensureDir();
            const filePath = path.join(this.historyDir, `${conversationId}.json`);
            await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
            console.log(`HistoryManager: Saved history for ${conversationId} to ${filePath}`);
        } catch (e: any) {
            console.error(`HistoryManager: Failed to save history: ${e.message}`);
            vscode.window.showErrorMessage(`Failed to save chat history: ${e.message}`);
        }
    }


    public async loadHistory(conversationId: string): Promise<any | null> {
        if (!this.historyDir) return null;
        const filePath = path.join(this.historyDir, `${conversationId}.json`);
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return JSON.parse(content);
        } catch (e) {
            return null;
        }
    }

    public async deleteHistory(conversationId: string) {
        if (!this.historyDir) return;
        const filePath = path.join(this.historyDir, `${conversationId}.json`);
        try {
            await fs.unlink(filePath);
            console.log(`HistoryManager: Deleted history file ${filePath}`);
        } catch (e: any) {
            console.error(`HistoryManager: Failed to delete history file: ${e.message}`);
            // Don't show error if file doesn't exist
            if (e.code !== 'ENOENT') {
                vscode.window.showErrorMessage(`Failed to delete history file: ${e.message}`);
            }
        }
    }


    public async listConversations(): Promise<any[]> {
        if (!this.historyDir) return [];
        try {
            await this.ensureDir();
            let files: string[] = [];
            try {
                files = await fs.readdir(this.historyDir);
            } catch (e) {
                return [];
            }

            const conversations = [];
            for (const file of files) {
                if (file.endsWith('.json')) {
                    try {
                        const content = await fs.readFile(path.join(this.historyDir, file), 'utf8');
                        const data = JSON.parse(content);
                        conversations.push({
                            id: data.id || file.replace('.json', ''),
                            title: data.title || 'Untitled Conversation',
                            timestamp: data.timestamp || Date.now()
                        });

                    } catch (e) {
                        console.error(`HistoryManager: Failed to read ${file}`);
                    }
                }
            }
            return conversations.sort((a, b) => b.timestamp - a.timestamp);
        } catch (e) {
            return [];
        }
    }

}
