import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ArtifactMetadata {
    id: string;
    name: string;
    type: 'implementation_plan' | 'walkthrough' | 'task' | 'code' | 'documentation' | 'other';
    summary: string;
    complexity: number; // 1-10
    createdAt: Date;
    updatedAt: Date;
    conversationId: string;
    filePath?: string;
    language?: string;
    tags?: string[];
}

export interface Artifact {
    metadata: ArtifactMetadata;
    content: string;
}

export class ArtifactManager {
    private artifacts: Map<string, Artifact> = new Map();
    private artifactsDir: string;

    constructor(private context: vscode.ExtensionContext) {
        this.artifactsDir = path.join(context.globalStorageUri.fsPath, 'artifacts');
        this.ensureArtifactsDir();
        this.loadArtifacts();
    }

    private async ensureArtifactsDir() {
        try {
            await fs.mkdir(this.artifactsDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create artifacts directory:', error);
        }
    }

    /**
     * Create a new artifact
     */
    async createArtifact(
        name: string,
        content: string,
        type: ArtifactMetadata['type'],
        summary: string,
        complexity: number,
        conversationId: string,
        options?: {
            language?: string;
            tags?: string[];
            filePath?: string;
        }
    ): Promise<Artifact> {
        const id = this.generateId();
        const now = new Date();

        const metadata: ArtifactMetadata = {
            id,
            name,
            type,
            summary,
            complexity,
            createdAt: now,
            updatedAt: now,
            conversationId,
            language: options?.language,
            tags: options?.tags,
            filePath: options?.filePath
        };

        const artifact: Artifact = { metadata, content };
        this.artifacts.set(id, artifact);

        await this.saveArtifact(artifact);
        return artifact;
    }

    /**
     * Update an existing artifact
     */
    async updateArtifact(
        id: string,
        updates: {
            content?: string;
            summary?: string;
            complexity?: number;
            tags?: string[];
        }
    ): Promise<Artifact | null> {
        const artifact = this.artifacts.get(id);
        if (!artifact) return null;

        if (updates.content !== undefined) {
            artifact.content = updates.content;
        }
        if (updates.summary !== undefined) {
            artifact.metadata.summary = updates.summary;
        }
        if (updates.complexity !== undefined) {
            artifact.metadata.complexity = updates.complexity;
        }
        if (updates.tags !== undefined) {
            artifact.metadata.tags = updates.tags;
        }

        artifact.metadata.updatedAt = new Date();
        await this.saveArtifact(artifact);
        return artifact;
    }

    /**
     * Get artifact by ID
     */
    getArtifact(id: string): Artifact | null {
        return this.artifacts.get(id) || null;
    }

    /**
     * Get all artifacts
     */
    getAllArtifacts(): Artifact[] {
        return Array.from(this.artifacts.values());
    }

    /**
     * Get artifacts by conversation ID
     */
    getArtifactsByConversation(conversationId: string): Artifact[] {
        return this.getAllArtifacts().filter(
            a => a.metadata.conversationId === conversationId
        );
    }

    /**
     * Get artifacts by type
     */
    getArtifactsByType(type: ArtifactMetadata['type']): Artifact[] {
        return this.getAllArtifacts().filter(a => a.metadata.type === type);
    }

    /**
     * Search artifacts by name or summary
     */
    searchArtifacts(query: string): Artifact[] {
        const lowerQuery = query.toLowerCase();
        return this.getAllArtifacts().filter(a =>
            a.metadata.name.toLowerCase().includes(lowerQuery) ||
            a.metadata.summary.toLowerCase().includes(lowerQuery) ||
            a.metadata.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
        );
    }

    /**
     * Delete artifact
     */
    async deleteArtifact(id: string): Promise<boolean> {
        const artifact = this.artifacts.get(id);
        if (!artifact) return false;

        this.artifacts.delete(id);

        try {
            const artifactPath = path.join(this.artifactsDir, `${id}.json`);
            await fs.unlink(artifactPath);
            return true;
        } catch (error) {
            console.error('Failed to delete artifact file:', error);
            return false;
        }
    }

    /**
     * Save artifact to disk
     */
    private async saveArtifact(artifact: Artifact) {
        try {
            const artifactPath = path.join(this.artifactsDir, `${artifact.metadata.id}.json`);
            await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');
        } catch (error) {
            console.error('Failed to save artifact:', error);
        }
    }

    /**
     * Load all artifacts from disk
     */
    private async loadArtifacts() {
        try {
            const files = await fs.readdir(this.artifactsDir);

            for (const file of files) {
                if (file.endsWith('.json')) {
                    try {
                        const filePath = path.join(this.artifactsDir, file);
                        const content = await fs.readFile(filePath, 'utf8');
                        const artifact: Artifact = JSON.parse(content);

                        // Convert date strings back to Date objects
                        artifact.metadata.createdAt = new Date(artifact.metadata.createdAt);
                        artifact.metadata.updatedAt = new Date(artifact.metadata.updatedAt);

                        this.artifacts.set(artifact.metadata.id, artifact);
                    } catch (error) {
                        console.error(`Failed to load artifact ${file}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load artifacts:', error);
        }
    }

    /**
     * Generate unique ID
     */
    private generateId(): string {
        return `artifact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Export artifact to workspace
     */
    async exportArtifact(id: string, targetPath: string): Promise<boolean> {
        const artifact = this.artifacts.get(id);
        if (!artifact) return false;

        try {
            const dir = path.dirname(targetPath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(targetPath, artifact.content, 'utf8');

            // Update artifact metadata with file path
            artifact.metadata.filePath = targetPath;
            await this.saveArtifact(artifact);

            return true;
        } catch (error) {
            console.error('Failed to export artifact:', error);
            return false;
        }
    }

    /**
     * Get artifact summary for display
     */
    getArtifactSummary(): string {
        const artifacts = this.getAllArtifacts();
        if (artifacts.length === 0) {
            return 'No artifacts created yet.';
        }

        const byType = artifacts.reduce((acc, a) => {
            acc[a.metadata.type] = (acc[a.metadata.type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        let summary = `Total Artifacts: ${artifacts.length}\n\n`;
        summary += 'By Type:\n';
        Object.entries(byType).forEach(([type, count]) => {
            summary += `- ${type}: ${count}\n`;
        });

        return summary;
    }
}
