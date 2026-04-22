import * as vscode from 'vscode';

export interface SymbolChange {
    name: string;
    type: 'added' | 'removed' | 'modified';
    kind: string;
    oldSignature?: string;
    newSignature?: string;
}

export class ASTAnalyzer {
    /**
     * Compare two file contents and detect symbol changes
     */
    async compareFiles(
        filePath: string,
        oldContent: string,
        newContent: string
    ): Promise<SymbolChange[]> {
        const changes: SymbolChange[] = [];

        try {
            const oldSymbols = await this.extractSymbolsFromContent(filePath, oldContent);
            const newSymbols = await this.extractSymbolsFromContent(filePath, newContent);

            // Create maps for easier comparison
            const oldSymbolMap = new Map(oldSymbols.map(s => [s.name, s]));
            const newSymbolMap = new Map(newSymbols.map(s => [s.name, s]));

            // Find removed symbols
            for (const [name, symbol] of oldSymbolMap) {
                if (!newSymbolMap.has(name)) {
                    changes.push({
                        name,
                        type: 'removed',
                        kind: symbol.kind,
                        oldSignature: symbol.signature
                    });
                }
            }

            // Find added and modified symbols
            for (const [name, newSymbol] of newSymbolMap) {
                const oldSymbol = oldSymbolMap.get(name);

                if (!oldSymbol) {
                    // New symbol
                    changes.push({
                        name,
                        type: 'added',
                        kind: newSymbol.kind,
                        newSignature: newSymbol.signature
                    });
                } else if (oldSymbol.signature !== newSymbol.signature) {
                    // Modified symbol
                    changes.push({
                        name,
                        type: 'modified',
                        kind: newSymbol.kind,
                        oldSignature: oldSymbol.signature,
                        newSignature: newSymbol.signature
                    });
                }
            }

        } catch (error) {
            console.error('ASTAnalyzer: Error comparing files:', error);
        }

        return changes;
    }

    /**
     * Extract symbols from file content using VS Code's language service
     */
    private async extractSymbolsFromContent(
        filePath: string,
        content: string
    ): Promise<Array<{ name: string; kind: string; signature: string }>> {
        try {
            // Create a temporary document
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);

            // Get symbols from the document
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );

            if (!symbols) {
                return [];
            }

            const result: Array<{ name: string; kind: string; signature: string }> = [];
            this.flattenSymbols(symbols, document, result);
            return result;

        } catch (error) {
            // If we can't use VS Code's provider, fall back to regex-based extraction
            return this.extractSymbolsWithRegex(content);
        }
    }

    /**
     * Flatten nested symbols into a flat array
     */
    private flattenSymbols(
        symbols: vscode.DocumentSymbol[],
        document: vscode.TextDocument,
        result: Array<{ name: string; kind: string; signature: string }>
    ): void {
        for (const symbol of symbols) {
            const signature = this.getSymbolSignature(symbol, document);
            result.push({
                name: symbol.name,
                kind: vscode.SymbolKind[symbol.kind],
                signature
            });

            // Process nested symbols
            if (symbol.children && symbol.children.length > 0) {
                this.flattenSymbols(symbol.children, document, result);
            }
        }
    }

    /**
     * Get signature for a symbol
     */
    private getSymbolSignature(symbol: vscode.DocumentSymbol, document: vscode.TextDocument): string {
        try {
            // Get the full line containing the symbol
            const line = document.lineAt(symbol.range.start.line);
            let signature = line.text.trim();

            // For functions/methods, try to get the full signature including parameters
            if (symbol.kind === vscode.SymbolKind.Function ||
                symbol.kind === vscode.SymbolKind.Method) {
                // Get text from symbol start to end
                const text = document.getText(symbol.range);
                const firstLine = text.split('\n')[0];
                signature = firstLine.trim();
            }

            return signature;
        } catch (error) {
            return symbol.detail || symbol.name;
        }
    }

    /**
     * Fallback: Extract symbols using regex (for when VS Code provider fails)
     */
    private extractSymbolsWithRegex(content: string): Array<{ name: string; kind: string; signature: string }> {
        const symbols: Array<{ name: string; kind: string; signature: string }> = [];

        // Function declarations
        const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)/g;
        let match;
        while ((match = functionRegex.exec(content)) !== null) {
            symbols.push({
                name: match[1],
                kind: 'Function',
                signature: match[0]
            });
        }

        // Class declarations
        const classRegex = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?/g;
        while ((match = classRegex.exec(content)) !== null) {
            symbols.push({
                name: match[1],
                kind: 'Class',
                signature: match[0]
            });
        }

        // Interface declarations
        const interfaceRegex = /(?:export\s+)?interface\s+(\w+)/g;
        while ((match = interfaceRegex.exec(content)) !== null) {
            symbols.push({
                name: match[1],
                kind: 'Interface',
                signature: match[0]
            });
        }

        // Type declarations
        const typeRegex = /(?:export\s+)?type\s+(\w+)\s*=/g;
        while ((match = typeRegex.exec(content)) !== null) {
            symbols.push({
                name: match[1],
                kind: 'Type',
                signature: match[0]
            });
        }

        // Const/let/var declarations
        const varRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)/g;
        while ((match = varRegex.exec(content)) !== null) {
            symbols.push({
                name: match[1],
                kind: 'Variable',
                signature: match[0]
            });
        }

        return symbols;
    }

    /**
     * Get removed symbol names from changes
     */
    getRemovedSymbols(changes: SymbolChange[]): string[] {
        return changes
            .filter(c => c.type === 'removed')
            .map(c => c.name);
    }

    /**
     * Get modified symbol names from changes
     */
    getModifiedSymbols(changes: SymbolChange[]): string[] {
        return changes
            .filter(c => c.type === 'modified')
            .map(c => c.name);
    }
}
