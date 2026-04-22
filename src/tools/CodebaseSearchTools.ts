import * as vscode from 'vscode';
import { CodebaseIndexer } from '../services/CodebaseIndexer';

export class CodebaseSearchManager {
    constructor(private indexer: CodebaseIndexer) { }

    public getTools() {
        return {
            search_symbols: {
                name: 'search_symbols',
                description: 'Search for symbols (classes, functions, etc.) across the entire codebase',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Symbol name or partial name' }
                    },
                    required: ['query']
                },
                execute: async (args: { query: string }) => {
                    return this.indexer.searchSymbols(args.query);
                }
            },
            list_files: {
                name: 'list_files',
                description: 'List files in a directory or the whole project',
                parameters: {
                    type: 'object',
                    properties: {
                        directory: { type: 'string', description: 'Directory to list. Use "." for root' }
                    }
                },
                execute: async (args: { directory?: string }) => {
                    const dir = args.directory === '.' ? '' : (args.directory || '');
                    return this.indexer.searchFiles(dir);
                }
            },
            get_project_tree: {
                name: 'get_project_tree',
                description: 'Get a text-based tree view of the project structure',
                parameters: {
                    type: 'object',
                    properties: {
                        depth: { type: 'number', description: 'Max depth to show' }
                    }
                },
                execute: async (args: { depth?: number }) => {
                    // Primitive tree generator
                    const files = this.indexer.searchFiles('');
                    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                    if (!root) return 'No workspace open';

                    const treeLines: string[] = [];
                    const maxDepth = args.depth || 3;

                    const buildTree = (currentDir: string, currentDepth: number) => {
                        if (currentDepth > maxDepth) return;

                        const relative = currentDir.replace(root, '');
                        const children = files.filter(f => {
                            const rel = f.path.replace(root, '').split(/[\\/]/).filter(x => x);
                            return f.path.startsWith(currentDir) && rel.length === currentDepth + 1;
                        });

                        for (const child of children) {
                            treeLines.push('  '.repeat(currentDepth) + '├── ' + child.name);
                        }
                    };

                    buildTree(root, 0);
                    return treeLines.join('\n') || 'Project too large or empty';
                }
            }
        };
    }
}
