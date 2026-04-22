import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export class ProjectMetadataProvider {
    /**
     * Get metadata from package.json or other project files
     */
    async getMetadata(workspaceRoot: string): Promise<string> {
        let metadata = "";

        try {
            const packageJsonPath = path.join(workspaceRoot, 'package.json');
            const content = await fs.readFile(packageJsonPath, 'utf8');
            const pkg = JSON.parse(content);

            metadata += `- Project: ${pkg.name || 'unnamed'} (v${pkg.version || '0.0.1'})\n`;
            if (pkg.description) metadata += `- Description: ${pkg.description}\n`;

            if (pkg.dependencies) {
                const deps = Object.keys(pkg.dependencies);
                metadata += `- Key Dependencies: ${deps.slice(0, 10).join(', ')}${deps.length > 10 ? '...' : ''}\n`;
            }

            if (pkg.scripts) {
                const scripts = Object.keys(pkg.scripts);
                metadata += `- Scripts: ${scripts.join(', ')}\n`;
            }
        } catch (e) {
            metadata += "- No package.json found\n";
        }

        // Check for other key files
        try {
            const files = await fs.readdir(workspaceRoot);
            const configs = files.filter(f => f.includes('config') || f.startsWith('.'));
            if (configs.length > 0) {
                metadata += `- Config Files: ${configs.slice(0, 10).join(', ')}\n`;
            }
        } catch (e) { }

        return metadata;
    }
}
