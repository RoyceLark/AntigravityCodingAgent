import * as vscode from 'vscode';
import * as path from 'path';

export interface FileInfo {
    path: string;
    name: string;
    extension: string;
    size: number;
    lastModified: number;
    type: 'file' | 'directory';
}

export interface SymbolInfo {
    name: string;
    kind: string; // 'function', 'class', 'interface', 'variable', etc.
    filePath: string;
    line: number;
    signature?: string;
}

export interface CodebaseIndex {
    files: Map<string, FileInfo>;
    symbols: Map<string, SymbolInfo[]>;
    dependencies: Map<string, string[]>;
    lastIndexed: number;
}

export class CodebaseIndexer {
    private index: CodebaseIndex;
    private isIndexing: boolean = false;
    private indexingProgress: vscode.Progress<{ message?: string; increment?: number }> | null = null;

    constructor(private context: vscode.ExtensionContext) {
        this.index = {
            files: new Map(),
            symbols: new Map(),
            dependencies: new Map(),
            lastIndexed: 0
        };
        this.setupWatcher();
    }

    private indexQueue: Set<string> = new Set();
    private indexTimeout: NodeJS.Timeout | null = null;

    private setupWatcher() {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');

        watcher.onDidCreate(uri => this.indexFile(uri));
        watcher.onDidChange(uri => {
            this.indexQueue.add(uri.fsPath);
            this.triggerDebouncedIndex();
        });
        watcher.onDidDelete(uri => {
            this.index.files.delete(uri.fsPath);
            this.index.symbols.delete(uri.fsPath);
        });

        this.context.subscriptions.push(watcher);
    }

    private triggerDebouncedIndex() {
        if (this.indexTimeout) clearTimeout(this.indexTimeout);
        this.indexTimeout = setTimeout(async () => {
            const queue = Array.from(this.indexQueue);
            this.indexQueue.clear();

            for (const filePath of queue) {
                const uri = vscode.Uri.file(filePath);
                await this.indexFile(uri);
                if (this.isCodeFile(path.extname(filePath))) {
                    await this.extractFileSymbols(filePath);
                }
            }
        }, 300); // 300ms debounce
    }

    /**
     * Index the entire workspace
     */
    async indexWorkspace(): Promise<void> {
        if (this.isIndexing) {
            console.log('CodebaseIndexer: Already indexing, skipping...');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            console.log('CodebaseIndexer: No workspace folders found');
            return;
        }

        this.isIndexing = true;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Indexing codebase...',
            cancellable: false
        }, async (progress) => {
            this.indexingProgress = progress;

            try {
                // Clear existing index
                this.index.files.clear();
                this.index.symbols.clear();
                this.index.dependencies.clear();

                // Index each workspace folder
                for (const folder of workspaceFolders) {
                    await this.indexDirectory(folder.uri);
                }

                // Extract symbols from indexed files
                await this.extractSymbols();

                this.index.lastIndexed = Date.now();
                console.log(`CodebaseIndexer: Indexed ${this.index.files.size} files with ${this.index.symbols.size} symbols`);
            } catch (error) {
                console.error('CodebaseIndexer: Error during indexing:', error);
            } finally {
                this.isIndexing = false;
                this.indexingProgress = null;
            }
        });
    }

    /**
     * Index a directory recursively
     */
    private async indexDirectory(uri: vscode.Uri): Promise<void> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);

            for (const [name, type] of entries) {
                // Skip common directories to ignore
                if (this.shouldIgnore(name)) {
                    continue;
                }

                const entryUri = vscode.Uri.joinPath(uri, name);

                if (type === vscode.FileType.Directory) {
                    await this.indexDirectory(entryUri);
                } else if (type === vscode.FileType.File) {
                    await this.indexFile(entryUri);
                }
            }
        } catch (error) {
            console.error(`CodebaseIndexer: Error indexing directory ${uri.fsPath}:`, error);
        }
    }

    /**
     * Index a single file
     */
    private async indexFile(uri: vscode.Uri): Promise<void> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            const ext = path.extname(uri.fsPath);

            // Only index text files
            if (!this.isTextFile(ext)) {
                return;
            }

            const fileInfo: FileInfo = {
                path: uri.fsPath,
                name: path.basename(uri.fsPath),
                extension: ext,
                size: stat.size,
                lastModified: stat.mtime,
                type: 'file'
            };

            this.index.files.set(uri.fsPath, fileInfo);
        } catch (error) {
            console.error(`CodebaseIndexer: Error indexing file ${uri.fsPath}:`, error);
        }
    }

    /**
     * Extract symbols from indexed files
     */
    private async extractSymbols(): Promise<void> {
        let processed = 0;
        const total = this.index.files.size;

        for (const [filePath, fileInfo] of this.index.files) {
            if (this.isCodeFile(fileInfo.extension)) {
                await this.extractFileSymbols(filePath);
            }

            processed++;
            if (this.indexingProgress && processed % 10 === 0) {
                this.indexingProgress.report({
                    message: `Extracting symbols... (${processed}/${total})`,
                    increment: (10 / total) * 100
                });
            }
        }
    }

    /**
     * Extract symbols from a single file using VS Code's symbol provider
     */
    private async extractFileSymbols(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );

            if (symbols && symbols.length > 0) {
                const symbolInfos: SymbolInfo[] = [];
                this.processSymbols(symbols, filePath, symbolInfos);

                if (symbolInfos.length > 0) {
                    this.index.symbols.set(filePath, symbolInfos);
                }
            }
        } catch (error) {
            // Silently fail for files that can't be parsed
        }
    }

    /**
     * Process symbols recursively
     */
    private processSymbols(symbols: vscode.DocumentSymbol[], filePath: string, result: SymbolInfo[]): void {
        for (const symbol of symbols) {
            result.push({
                name: symbol.name,
                kind: vscode.SymbolKind[symbol.kind],
                filePath: filePath,
                line: symbol.range.start.line,
                signature: symbol.detail
            });

            // Process nested symbols
            if (symbol.children && symbol.children.length > 0) {
                this.processSymbols(symbol.children, filePath, result);
            }
        }
    }

    /**
     * Search for files by name or path
     */
    searchFiles(query: string): FileInfo[] {
        const lowerQuery = query.toLowerCase();
        const results: FileInfo[] = [];

        for (const fileInfo of this.index.files.values()) {
            if (fileInfo.name.toLowerCase().includes(lowerQuery) ||
                fileInfo.path.toLowerCase().includes(lowerQuery)) {
                results.push(fileInfo);
            }
        }

        return results.slice(0, 50); // Limit results
    }

    /**
     * Search for symbols by name
     */
    searchSymbols(query: string): SymbolInfo[] {
        const lowerQuery = query.toLowerCase();
        const results: SymbolInfo[] = [];

        for (const symbols of this.index.symbols.values()) {
            for (const symbol of symbols) {
                if (symbol.name.toLowerCase().includes(lowerQuery)) {
                    results.push(symbol);
                }
            }
        }

        return results.slice(0, 50); // Limit results
    }

    /**
     * Get all symbols in a file
     */
    getFileSymbols(filePath: string): SymbolInfo[] {
        return this.index.symbols.get(filePath) || [];
    }

    /**
     * Get file info
     */
    getFileInfo(filePath: string): FileInfo | undefined {
        return this.index.files.get(filePath);
    }

    /**
     * Get index statistics
     */
    getStats() {
        return {
            totalFiles: this.index.files.size,
            totalSymbols: Array.from(this.index.symbols.values()).reduce((sum, symbols) => sum + symbols.length, 0),
            lastIndexed: this.index.lastIndexed,
            isIndexing: this.isIndexing
        };
    }

    /**
     * Check if a path should be ignored
     */
    private shouldIgnore(name: string): boolean {
        const ignorePatterns = [
            'node_modules',
            '.git',
            'dist',
            'out',
            'build',
            '.vscode',
            'coverage',
            '.next',
            '.nuxt',
            '__pycache__',
            'venv',
            '.env'
        ];

        return ignorePatterns.some(pattern => name === pattern || name.startsWith('.'));
    }

    /**
     * Check if file extension is a text file
     */
    private isTextFile(ext: string): boolean {
        const textExtensions = [
            '.ts', '.js', '.tsx', '.jsx', '.json', '.md', '.txt',
            '.css', '.scss', '.sass', '.less', '.html', '.xml',
            '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go',
            '.rs', '.rb', '.php', '.swift', '.kt', '.scala',
            '.yml', '.yaml', '.toml', '.ini', '.conf', '.sh'
        ];

        return textExtensions.includes(ext.toLowerCase());
    }

    /**
     * Check if file is a code file (for symbol extraction)
     */
    private isCodeFile(ext: string): boolean {
        const codeExtensions = [
            '.ts', '.js', '.tsx', '.jsx',
            '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go',
            '.rs', '.rb', '.php', '.swift', '.kt', '.scala'
        ];

        return codeExtensions.includes(ext.toLowerCase());
    }
}
