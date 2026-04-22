import * as vscode from 'vscode';
import { CodebaseIndexer, FileInfo, SymbolInfo } from './CodebaseIndexer';
import { DependencyAnalyzer } from './DependencyAnalyzer';
import { KnowledgeService } from './KnowledgeService';
import { ProjectGuidelinesProvider } from './ProjectGuidelinesProvider';

export interface CodeSnippet {
    filePath: string;
    content: string;
    startLine: number;
    endLine: number;
    relevance: number;
}

export interface CodeContext {
    query: string;
    intent: 'read' | 'create' | 'modify' | 'explain' | 'debug' | 'refactor' | 'unknown';
    relevantFiles: FileInfo[];
    relevantSymbols: SymbolInfo[];
    codeSnippets: CodeSnippet[];
    confidence: number;
    relevantKIs?: { title: string, summary: string }[];
    guidelines?: string;
}

export class ContextBuilder {
    constructor(
        private indexer: CodebaseIndexer,
        private dependencyAnalyzer?: DependencyAnalyzer,
        private knowledgeService?: KnowledgeService,
        private guidelinesProvider?: ProjectGuidelinesProvider
    ) { }

    /**
     * Build context for a user query
     */
    async buildContext(query: string, editor?: vscode.TextEditor): Promise<CodeContext> {
        const intent = this.classifyIntent(query);
        const keywords = this.extractKeywords(query);

        // Search for relevant files and symbols
        const relevantFiles = this.findRelevantFiles(keywords);
        const relevantSymbols = this.findRelevantSymbols(keywords);

        // Get code snippets from relevant files
        const codeSnippets = await this.extractCodeSnippets(relevantFiles, relevantSymbols, keywords);

        // Add context from the active editor if present
        if (editor) {
            const activeSnippet = await this.getActiveEditorSnippet(editor, intent);
            if (activeSnippet) {
                // Prepend to prioritize current editor context
                codeSnippets.unshift(activeSnippet);
            }
        }

        // Calculate confidence score
        const confidence = this.calculateConfidence(relevantFiles, relevantSymbols, codeSnippets, !!editor);

        // Retrieve Relevant KIs
        let relevantKIs: { title: string, summary: string }[] = [];
        if (this.knowledgeService) {
            const allKIs = await this.knowledgeService.listKIs();
            relevantKIs = allKIs
                .filter(ki => keywords.some(k => ki.title.toLowerCase().includes(k) || ki.summary.toLowerCase().includes(k)))
                .map(ki => ({ title: ki.title, summary: ki.summary }));
        }

        // Retrieve Guidelines (brief cached version or subset)
        let guidelines = "";
        if (this.guidelinesProvider && editor) {
            const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
            guidelines = await this.guidelinesProvider.getGuidelines(root);
        }

        return {
            query,
            intent,
            relevantFiles,
            relevantSymbols,
            codeSnippets,
            confidence,
            relevantKIs,
            guidelines
        };
    }

    /**
     * Extract context around the cursor in the active editor
     */
    private async getActiveEditorSnippet(editor: vscode.TextEditor, intent: CodeContext['intent']): Promise<CodeSnippet | null> {
        const doc = editor.document;
        const selection = editor.selection;

        // Define range to extract: more context for debugging/refactoring
        let linesBefore = 10;
        let linesAfter = 20;

        if (intent === 'debug' || intent === 'refactor') {
            linesBefore = 20;
            linesAfter = 40;
        }

        const startLine = Math.max(0, selection.active.line - linesBefore);
        const endLine = Math.min(doc.lineCount - 1, selection.active.line + linesAfter);

        const content = doc.getText(new vscode.Range(startLine, 0, endLine, 0));

        return {
            filePath: doc.fileName,
            content: content,
            startLine,
            endLine,
            relevance: 1.0 // Active file has highest relevance
        };
    }

    /**
     * Classify user intent from query
     */
    private classifyIntent(query: string): CodeContext['intent'] {
        const lowerQuery = query.toLowerCase();

        // Read/Explain patterns
        if (lowerQuery.match(/^(how does|how do|what is|what does|explain|show me|where is|find)/)) {
            return 'explain';
        }

        // Create patterns
        if (lowerQuery.match(/^(add|create|implement|build|make a new|generate)/)) {
            return 'create';
        }

        // Modify patterns
        if (lowerQuery.match(/^(update|change|modify|edit|fix|improve|enhance|refactor)/)) {
            return 'modify';
        }

        // Debug patterns
        if (lowerQuery.match(/^(debug|why|error|issue|problem|not working|broken)/)) {
            return 'debug';
        }

        // Refactor patterns
        if (lowerQuery.match(/^(refactor|reorganize|restructure|optimize|clean up)/)) {
            return 'refactor';
        }

        return 'unknown';
    }

    /**
     * Extract keywords from query
     */
    private extractKeywords(query: string): string[] {
        // Remove common words
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
            'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
            'should', 'could', 'may', 'might', 'can', 'how', 'what', 'where',
            'when', 'why', 'which', 'who', 'this', 'that', 'these', 'those'
        ]);

        const words = query
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word));

        return [...new Set(words)]; // Remove duplicates
    }

    /**
     * Find relevant files based on keywords
     */
    private findRelevantFiles(keywords: string[]): FileInfo[] {
        const fileScores = new Map<string, number>();

        for (const keyword of keywords) {
            const matchingFiles = this.indexer.searchFiles(keyword);

            for (const file of matchingFiles) {
                const currentScore = fileScores.get(file.path) || 0;
                const score = this.calculateFileRelevance(file, keyword);
                fileScores.set(file.path, currentScore + score);
            }
        }

        // Boost for related files (dependents/dependencies)
        if (this.dependencyAnalyzer) {
            const topFiles = Array.from(fileScores.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);

            for (const [path, score] of topFiles) {
                const related = this.dependencyAnalyzer.getRelatedFiles(path);
                for (const relPath of related) {
                    const currentScore = fileScores.get(relPath) || 0;
                    fileScores.set(relPath, currentScore + score * 0.4); // Add 40% of parent score
                }
            }
        }

        // Sort by score and return top results
        return Array.from(fileScores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([path]) => this.indexer.getFileInfo(path)!)
            .filter(file => file !== undefined);
    }

    /**
     * Calculate file relevance score
     */
    private calculateFileRelevance(file: FileInfo, keyword: string): number {
        let score = 0;
        const lowerKeyword = keyword.toLowerCase();
        const lowerName = file.name.toLowerCase();
        const lowerPath = file.path.toLowerCase();

        // Exact name match
        if (lowerName === lowerKeyword) {
            score += 10;
        }
        // Name contains keyword
        else if (lowerName.includes(lowerKeyword)) {
            score += 5;
        }
        // Path contains keyword
        else if (lowerPath.includes(lowerKeyword)) {
            score += 2;
        }

        // Boost for code files
        if (['.ts', '.js', '.tsx', '.jsx'].includes(file.extension)) {
            score += 1;
        }

        return score;
    }

    /**
     * Find relevant symbols based on keywords
     */
    private findRelevantSymbols(keywords: string[]): SymbolInfo[] {
        const symbolScores = new Map<string, { symbol: SymbolInfo; score: number }>();

        for (const keyword of keywords) {
            const matchingSymbols = this.indexer.searchSymbols(keyword);

            for (const symbol of matchingSymbols) {
                const key = `${symbol.filePath}:${symbol.name}:${symbol.line}`;
                const currentEntry = symbolScores.get(key);
                const score = this.calculateSymbolRelevance(symbol, keyword);

                if (currentEntry) {
                    currentEntry.score += score;
                } else {
                    symbolScores.set(key, { symbol, score });
                }
            }
        }

        // Sort by score and return top results
        return Array.from(symbolScores.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 20)
            .map(entry => entry.symbol);
    }

    /**
     * Calculate symbol relevance score
     */
    private calculateSymbolRelevance(symbol: SymbolInfo, keyword: string): number {
        let score = 0;
        const lowerKeyword = keyword.toLowerCase();
        const lowerName = symbol.name.toLowerCase();

        // Exact match
        if (lowerName === lowerKeyword) {
            score += 10;
        }
        // Name contains keyword
        else if (lowerName.includes(lowerKeyword)) {
            score += 5;
        }

        // Boost for certain symbol types
        if (symbol.kind === 'Class' || symbol.kind === 'Interface') {
            score += 2;
        } else if (symbol.kind === 'Function' || symbol.kind === 'Method') {
            score += 1;
        }

        return score;
    }

    /**
     * Extract code snippets from relevant files
     */
    private async extractCodeSnippets(
        files: FileInfo[],
        symbols: SymbolInfo[],
        keywords: string[]
    ): Promise<CodeSnippet[]> {
        const snippets: CodeSnippet[] = [];

        // Get snippets around symbols
        for (const symbol of symbols.slice(0, 5)) { // Limit to top 5 symbols
            try {
                const snippet = await this.getSymbolSnippet(symbol);
                if (snippet) {
                    snippets.push(snippet);
                }
            } catch (error) {
                // Skip if can't read file
            }
        }

        // Get snippets from top files
        for (const file of files.slice(0, 3)) { // Limit to top 3 files
            try {
                const fileSnippets = await this.getFileSnippets(file, keywords);
                snippets.push(...fileSnippets);
            } catch (error) {
                // Skip if can't read file
            }
        }

        return snippets.slice(0, 10); // Limit total snippets
    }

    /**
     * Get code snippet around a symbol
     */
    private async getSymbolSnippet(symbol: SymbolInfo): Promise<CodeSnippet | null> {
        try {
            const uri = vscode.Uri.file(symbol.filePath);
            const document = await vscode.workspace.openTextDocument(uri);

            // Get 10 lines before and after the symbol
            const startLine = Math.max(0, symbol.line - 5);
            const endLine = Math.min(document.lineCount - 1, symbol.line + 15);

            const lines: string[] = [];
            for (let i = startLine; i <= endLine; i++) {
                lines.push(document.lineAt(i).text);
            }

            return {
                filePath: symbol.filePath,
                content: lines.join('\n'),
                startLine,
                endLine,
                relevance: 0.8
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Get code snippets from a file based on keywords
     */
    private async getFileSnippets(file: FileInfo, keywords: string[]): Promise<CodeSnippet[]> {
        try {
            const uri = vscode.Uri.file(file.path);
            const document = await vscode.workspace.openTextDocument(uri);
            const snippets: CodeSnippet[] = [];

            // Search for keyword occurrences
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;
                const lowerLine = line.toLowerCase();

                for (const keyword of keywords) {
                    if (lowerLine.includes(keyword.toLowerCase())) {
                        // Get context around the match
                        const startLine = Math.max(0, i - 3);
                        const endLine = Math.min(document.lineCount - 1, i + 7);

                        const lines: string[] = [];
                        for (let j = startLine; j <= endLine; j++) {
                            lines.push(document.lineAt(j).text);
                        }

                        snippets.push({
                            filePath: file.path,
                            content: lines.join('\n'),
                            startLine,
                            endLine,
                            relevance: 0.6
                        });

                        break; // Only one snippet per line
                    }
                }
            }

            return snippets.slice(0, 3); // Limit snippets per file
        } catch (error) {
            return [];
        }
    }

    /**
     * Calculate confidence score for the context
     */
    private calculateConfidence(
        files: FileInfo[],
        symbols: SymbolInfo[],
        snippets: CodeSnippet[],
        hasActiveEditor: boolean
    ): number {
        let confidence = 0;

        // Base confidence from findings
        if (files.length > 0) confidence += 0.3;
        if (symbols.length > 0) confidence += 0.3;
        if (snippets.length > 0) confidence += 0.2;

        // Boost for active editor context
        if (hasActiveEditor) confidence += 0.2;

        // Boost for multiple findings
        if (files.length >= 3) confidence += 0.1;
        if (symbols.length >= 5) confidence += 0.1;

        return Math.min(1.0, confidence);
    }

    /**
     * Format context for AI prompt
     */
    formatContextForPrompt(context: CodeContext): string {
        let prompt = `# Codebase Context\n\n`;
        prompt += `**User Query:** ${context.query}\n`;
        prompt += `**Detected Intent:** ${context.intent}\n`;
        prompt += `**Confidence:** ${(context.confidence * 100).toFixed(0)}%\n\n`;

        if (context.relevantFiles.length > 0) {
            prompt += `## Relevant Files (${context.relevantFiles.length})\n`;
            for (const file of context.relevantFiles.slice(0, 5)) {
                prompt += `- ${file.path}\n`;
            }
            prompt += `\n`;
        }

        if (context.relevantSymbols.length > 0) {
            prompt += `## Relevant Symbols (${context.relevantSymbols.length})\n`;
            for (const symbol of context.relevantSymbols.slice(0, 10)) {
                prompt += `- **${symbol.name}** (${symbol.kind}) in ${symbol.filePath}:${symbol.line}\n`;
            }
            prompt += `\n`;
        }

        if (context.codeSnippets.length > 0) {
            prompt += `## Code Snippets\n\n`;
            for (const snippet of context.codeSnippets.slice(0, 5)) {
                prompt += `### ${snippet.filePath} (lines ${snippet.startLine}-${snippet.endLine})\n`;
                prompt += `\`\`\`\n${snippet.content}\n\`\`\`\n\n`;
            }
        }

        return prompt;
    }
}
