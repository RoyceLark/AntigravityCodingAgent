import * as vscode from 'vscode';
import * as path from 'path';

export const SearchTools = {
    searchWeb: {
        name: 'search_web',
        description: 'Performs a web search for a given query',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query' }
            },
            required: ['query']
        },
        execute: async (args: { query: string }) => {
            // In a real implementation, this would use a search API like Serper or Google
            // For this version, we'll return a placeholder or simulate a search
            return `Search results for: ${args.query}\n1. https://docs.example.com\n2. https://github.com/example/repo`;
        }
    },
    grepSearch: {
        name: 'grep_search',
        description: 'Search for string patterns in the workspace with snippets',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Pattern to search for' },
                include: { type: 'string', description: 'File pattern to include' }
            },
            required: ['query']
        },
        execute: async (args: { query: string, include?: string }) => {
            const files = await vscode.workspace.findFiles(args.include || '**/*');
            const results = [];
            for (const file of files) {
                if (results.length > 50) break; // Limit total results

                try {
                    const doc = await vscode.workspace.openTextDocument(file);
                    const text = doc.getText();
                    const lines = text.split('\n');

                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].includes(args.query)) {
                            results.push({
                                file: vscode.workspace.asRelativePath(file),
                                line: i + 1,
                                snippet: lines[i].trim()
                            });
                            if (results.length > 50) break;
                        }
                    }
                } catch { continue; }
            }
            return results;
        }
    }
};
