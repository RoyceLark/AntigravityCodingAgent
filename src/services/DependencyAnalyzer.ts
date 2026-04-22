import * as vscode from 'vscode';
import { CodebaseIndexer, SymbolInfo } from './CodebaseIndexer';
import * as path from 'path';

export interface DependencyInfo {
    filePath: string;
    imports: string[];
    exports: string[];
    dependencies: string[];
    dependents: string[];
}

export interface BreakingChange {
    type: 'symbol_removal' | 'signature_change' | 'export_removal' | 'file_deletion';
    severity: 'high' | 'medium' | 'low';
    affectedFile: string;
    affectedSymbol?: string;
    impactedFiles: string[];
    description: string;
    suggestion?: string;
}

export class DependencyAnalyzer {
    private dependencyGraph: Map<string, DependencyInfo> = new Map();
    private symbolUsageMap: Map<string, Set<string>> = new Map(); // symbol -> files using it

    constructor(private indexer: CodebaseIndexer) { }

    /**
     * Build dependency graph for the workspace
     */
    async buildDependencyGraph(): Promise<void> {
        const stats = this.indexer.getStats();
        console.log(`DependencyAnalyzer: Building dependency graph for ${stats.totalFiles} files...`);

        this.dependencyGraph.clear();
        this.symbolUsageMap.clear();

        // Get all indexed files
        const allFiles = this.indexer.searchFiles('');

        for (const file of allFiles) {
            await this.analyzeFileDependencies(file.path);
        }

        console.log(`DependencyAnalyzer: Built graph with ${this.dependencyGraph.size} files`);
    }

    /**
     * Analyze dependencies for a single file
     */
    private async analyzeFileDependencies(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();

            const imports = this.extractImports(content, filePath);
            const exports = this.extractExports(content);

            const depInfo: DependencyInfo = {
                filePath,
                imports,
                exports,
                dependencies: [],
                dependents: []
            };

            this.dependencyGraph.set(filePath, depInfo);

            // Track symbol usage
            const symbols = this.indexer.getFileSymbols(filePath);
            for (const symbol of symbols) {
                const key = `${symbol.filePath}:${symbol.name}`;
                if (!this.symbolUsageMap.has(key)) {
                    this.symbolUsageMap.set(key, new Set());
                }
            }

        } catch (error) {
            // Skip files that can't be read
        }
    }

    /**
     * Extract import statements from file content
     */
    private extractImports(content: string, filePath: string): string[] {
        const imports: string[] = [];

        // TypeScript/JavaScript imports
        const importRegex = /import\s+(?:{[^}]+}|[\w*]+)\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
            imports.push(match[1]);
        }

        // require() statements
        const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        while ((match = requireRegex.exec(content)) !== null) {
            imports.push(match[1]);
        }

        return imports;
    }

    /**
     * Extract export statements from file content
     */
    private extractExports(content: string): string[] {
        const exports: string[] = [];

        // Named exports
        const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
        let match;
        while ((match = namedExportRegex.exec(content)) !== null) {
            exports.push(match[1]);
        }

        // Export { ... }
        const exportBlockRegex = /export\s+{([^}]+)}/g;
        while ((match = exportBlockRegex.exec(content)) !== null) {
            const items = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]);
            exports.push(...items);
        }

        return exports;
    }

    /**
     * Detect potential breaking changes for a file modification
     */
    async detectBreakingChanges(
        filePath: string,
        modificationType: 'edit' | 'delete',
        removedSymbols?: string[],
        modifiedSymbols?: string[]
    ): Promise<BreakingChange[]> {
        const breakingChanges: BreakingChange[] = [];

        if (modificationType === 'delete') {
            // File deletion - check all dependents
            const change = await this.analyzeFileDeletion(filePath);
            if (change) {
                breakingChanges.push(change);
            }
        } else {
            // File edit - check symbol changes
            if (removedSymbols && removedSymbols.length > 0) {
                for (const symbol of removedSymbols) {
                    const change = await this.analyzeSymbolRemoval(filePath, symbol);
                    if (change) {
                        breakingChanges.push(change);
                    }
                }
            }

            if (modifiedSymbols && modifiedSymbols.length > 0) {
                for (const symbol of modifiedSymbols) {
                    const change = await this.analyzeSymbolModification(filePath, symbol);
                    if (change) {
                        breakingChanges.push(change);
                    }
                }
            }
        }

        return breakingChanges;
    }

    /**
     * Analyze impact of file deletion
     */
    private async analyzeFileDeletion(filePath: string): Promise<BreakingChange | null> {
        const impactedFiles = await this.findFileUsages(filePath);

        if (impactedFiles.length === 0) {
            return null;
        }

        return {
            type: 'file_deletion',
            severity: 'high',
            affectedFile: filePath,
            impactedFiles,
            description: `Deleting this file will break ${impactedFiles.length} file(s) that import from it`,
            suggestion: `Review and update imports in: ${impactedFiles.slice(0, 3).join(', ')}${impactedFiles.length > 3 ? '...' : ''}`
        };
    }

    /**
     * Analyze impact of symbol removal
     */
    private async analyzeSymbolRemoval(filePath: string, symbolName: string): Promise<BreakingChange | null> {
        const impactedFiles = await this.findSymbolUsages(filePath, symbolName);

        if (impactedFiles.length === 0) {
            return null;
        }

        return {
            type: 'symbol_removal',
            severity: impactedFiles.length > 5 ? 'high' : 'medium',
            affectedFile: filePath,
            affectedSymbol: symbolName,
            impactedFiles,
            description: `Removing '${symbolName}' will affect ${impactedFiles.length} file(s)`,
            suggestion: `Consider deprecating instead of removing, or update all usages first`
        };
    }

    /**
     * Analyze impact of symbol modification
     */
    private async analyzeSymbolModification(filePath: string, symbolName: string): Promise<BreakingChange | null> {
        const impactedFiles = await this.findSymbolUsages(filePath, symbolName);

        if (impactedFiles.length === 0) {
            return null;
        }

        return {
            type: 'signature_change',
            severity: impactedFiles.length > 10 ? 'high' : 'low',
            affectedFile: filePath,
            affectedSymbol: symbolName,
            impactedFiles,
            description: `Modifying '${symbolName}' may affect ${impactedFiles.length} file(s)`,
            suggestion: `Ensure backward compatibility or update all call sites`
        };
    }

    /**
     * Find all files that import from a given file
     */
    private async findFileUsages(filePath: string): Promise<string[]> {
        const usages: string[] = [];
        const fileName = filePath.split(/[\\/]/).pop() || '';
        const fileNameWithoutExt = fileName.replace(/\.[^.]+$/, '');

        for (const [depFilePath, depInfo] of this.dependencyGraph) {
            if (depFilePath === filePath) continue;

            for (const imp of depInfo.imports) {
                // Check if import matches the file
                if (imp.includes(fileNameWithoutExt) || imp.includes(fileName)) {
                    usages.push(depFilePath);
                    break;
                }
            }
        }

        return usages;
    }

    /**
     * Find all files that use a specific symbol
     */
    private async findSymbolUsages(filePath: string, symbolName: string): Promise<string[]> {
        const usages: Set<string> = new Set();

        // Search for symbol usage in all files
        const allFiles = this.indexer.searchFiles('');

        for (const file of allFiles) {
            if (file.path === filePath) continue;

            try {
                const uri = vscode.Uri.file(file.path);
                const document = await vscode.workspace.openTextDocument(uri);
                const content = document.getText();

                // Check if file imports from the affected file
                const imports = this.extractImports(content, file.path);
                const fileName = filePath.split(/[\\/]/).pop() || '';
                const fileNameWithoutExt = fileName.replace(/\.[^.]+$/, '');

                const importsFromFile = imports.some(imp =>
                    imp.includes(fileNameWithoutExt) || imp.includes(fileName)
                );

                if (importsFromFile) {
                    // Check if symbol is used in the content
                    const symbolRegex = new RegExp(`\\b${symbolName}\\b`, 'g');
                    if (symbolRegex.test(content)) {
                        usages.add(file.path);
                    }
                }
            } catch (error) {
                // Skip files that can't be read
            }
        }

        return Array.from(usages);
    }

    /**
     * Get dependency information for a file
     */
    getDependencyInfo(filePath: string): DependencyInfo | undefined {
        return this.dependencyGraph.get(filePath);
    }

    /**
     * Get all files that depend on a given file
     */
    getDependents(filePath: string): string[] {
        const dependents: string[] = [];

        for (const [depFilePath, depInfo] of this.dependencyGraph) {
            if (depInfo.dependencies.includes(filePath)) {
                dependents.push(depFilePath);
            }
        }

        return dependents;
    }

    /**
     * Get all files that this file depends on
     */
    getDependencies(filePath: string): string[] {
        const info = this.dependencyGraph.get(filePath);
        return info ? info.dependencies : [];
    }

    /**
     * Get all related files (both directions)
     */
    getRelatedFiles(filePath: string): string[] {
        return [...new Set([...this.getDependencies(filePath), ...this.getDependents(filePath)])];
    }

    /**
     * Get statistics about the dependency graph
     */
    getStats() {
        return {
            totalFiles: this.dependencyGraph.size,
            totalSymbols: this.symbolUsageMap.size,
            avgDependencies: Array.from(this.dependencyGraph.values())
                .reduce((sum, info) => sum + info.dependencies.length, 0) / this.dependencyGraph.size
        };
    }

    /**
     * Perform a deep impact analysis for a file
     */
    async getImpactAnalysis(filePath: string): Promise<{ score: number, summary: string, criticality: 'low' | 'medium' | 'high' }> {
        const dependents = this.getDependents(filePath);
        const dependentsCount = dependents.length;

        let score = dependentsCount * 10;

        // Boost for common "God" patterns
        const fileName = path.basename(filePath).toLowerCase();
        if (fileName.includes('util') || fileName.includes('core') || fileName.includes('base') || fileName.includes('context')) {
            score *= 1.5;
        }

        const criticality = score > 100 ? 'high' : score > 30 ? 'medium' : 'low';

        let summary = `Impact Score: ${score.toFixed(0)} (${criticality.toUpperCase()})\n`;
        summary += `- Dependents: ${dependentsCount} file(s) rely on this file.\n`;

        if (dependentsCount > 0) {
            summary += `- Affected Files: ${dependents.slice(0, 5).join(', ')}${dependentsCount > 5 ? '...' : ''}\n`;
        }

        if (criticality === 'high') {
            summary += `! WARNING: This is a CRITICAL core file. Any change here may ripple through the entire system. Request a deep 'find_references' scan before editing.`;
        }

        return { score, summary, criticality };
    }

    /**
     * Format breaking changes for display
     */
    formatBreakingChanges(changes: BreakingChange[]): string {
        if (changes.length === 0) {
            return '✅ No breaking changes detected';
        }

        let output = `⚠️ **${changes.length} Potential Breaking Change(s) Detected**\n\n`;

        for (const change of changes) {
            const severityIcon = change.severity === 'high' ? '🔴' : change.severity === 'medium' ? '🟡' : '🟢';

            output += `${severityIcon} **${change.type.replace(/_/g, ' ').toUpperCase()}**\n`;
            output += `   File: ${change.affectedFile}\n`;
            if (change.affectedSymbol) {
                output += `   Symbol: ${change.affectedSymbol}\n`;
            }
            output += `   Impact: ${change.impactedFiles.length} file(s)\n`;
            output += `   ${change.description}\n`;
            if (change.suggestion) {
                output += `   💡 ${change.suggestion}\n`;
            }
            output += '\n';
        }

        return output;
    }
}
