import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export class KnowledgeService {
    private storageUri: vscode.Uri;

    constructor(context: vscode.ExtensionContext) {
        this.storageUri = context.globalStorageUri;
    }

    private async ensureDir() {
        try {
            await fs.mkdir(this.storageUri.fsPath, { recursive: true });
            await fs.mkdir(path.join(this.storageUri.fsPath, 'knowledge'), { recursive: true });
        } catch { }
    }

    public async saveKI(title: string, content: string, summary: string) {
        await this.ensureDir();
        const kiId = title.toLowerCase().replace(/\s+/g, '_');
        const kiPath = path.join(this.storageUri.fsPath, 'knowledge', `${kiId}.json`);

        const ki = {
            id: kiId,
            title,
            content,
            summary,
            timestamp: new Date().toISOString()
        };

        await fs.writeFile(kiPath, JSON.stringify(ki, null, 2), 'utf8');
        return kiId;
    }

    public async listKIs() {
        await this.ensureDir();
        const kiDir = path.join(this.storageUri.fsPath, 'knowledge');
        const files = await fs.readdir(kiDir);
        const kis = [];
        for (const file of files) {
            const data = await fs.readFile(path.join(kiDir, file), 'utf8');
            kis.push(JSON.parse(data));
        }
        return kis;
    }

    public async getKI(id: string) {
        const kiPath = path.join(this.storageUri.fsPath, 'knowledge', `${id}.json`);
        const data = await fs.readFile(kiPath, 'utf8');
        return JSON.parse(data);
    }
}
