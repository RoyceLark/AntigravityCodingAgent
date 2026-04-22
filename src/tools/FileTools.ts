import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { commandApprovalService } from '../services/CommandApprovalService';

export const FileTools = {
    listDir: {
        name: 'list_dir',
        description: 'List the contents of a directory',
        parameters: {
            type: 'object',
            properties: {
                directoryPath: { type: 'string', description: 'Absolute path to the directory' }
            },
            required: ['directoryPath']
        },
        execute: async (args: { directoryPath: string }) => {
            const files = await fs.readdir(args.directoryPath, { withFileTypes: true });
            const result = await Promise.all(files.map(async f => ({
                name: f.name,
                isDirectory: f.isDirectory(),
                size: f.isFile() ? (await fs.stat(path.join(args.directoryPath, f.name))).size : undefined
            })));
            return result;
        }
    },

    viewFile: {
        name: 'view_file',
        description: 'View the contents of a file',
        parameters: {
            type: 'object',
            properties: {
                absolutePath: { type: 'string', description: 'Absolute path to the file' },
                startLine: { type: 'number', description: 'Starting line (1-indexed)' },
                endLine: { type: 'number', description: 'Ending line (1-indexed)' }
            },
            required: ['absolutePath']
        },
        execute: async (args: { absolutePath: string, startLine?: number, endLine?: number }) => {
            const content = await fs.readFile(args.absolutePath, 'utf8');
            const lines = content.split('\n');
            if (args.startLine || args.endLine) {
                const start = (args.startLine || 1) - 1;
                const end = args.endLine || lines.length;
                return lines.slice(start, end).join('\n');
            }
            return content;
        }
    },

    writeToFile: {
        name: 'write_to_file',
        description: 'Create a new file or overwrite an existing one',
        parameters: {
            type: 'object',
            properties: {
                targetFile: { type: 'string', description: 'Absolute path to the file' },
                codeContent: { type: 'string', description: 'Content to write' },
                overwrite: { type: 'boolean', description: 'Whether to overwrite if exists' }
            },
            required: ['targetFile', 'codeContent', 'overwrite']
        },
        execute: async (args: { targetFile: string, codeContent: string, overwrite: boolean }) => {
            const dir = path.dirname(args.targetFile);
            await fs.mkdir(dir, { recursive: true });

            let fileExists = false;
            try {
                await fs.access(args.targetFile);
                fileExists = true;
            } catch { }

            if (!args.overwrite && fileExists) {
                throw new Error('File already exists and overwrite is false');
            }

            // Approval Flow: Newly created don't ask, edits/overwrites do
            const approved = await commandApprovalService.requestApproval({
                command: `${fileExists ? 'Overwrite' : 'Create'} ${args.targetFile}`,
                cwd: dir,
                safeToAutoRun: !fileExists, // Auto-approve if new
                description: `${fileExists ? 'Overwriting existing' : 'Creating new'} file: ${path.basename(args.targetFile)}`
            });

            if (!approved) {
                return { status: 'cancelled', message: 'File operation cancelled by user' };
            }

            await fs.writeFile(args.targetFile, args.codeContent, 'utf8');
            return {
                status: 'success',
                message: 'File written successfully',
                fileName: path.basename(args.targetFile),
                path: args.targetFile,
                content: args.codeContent
            };
        }
    },

    replaceFileContent: {
        name: 'replace_file_content',
        description: 'Replace a block of text in a file',
        parameters: {
            type: 'object',
            properties: {
                targetFile: { type: 'string', description: 'Absolute path to the file' },
                targetContent: { type: 'string', description: 'The exact string to replace' },
                replacementContent: { type: 'string', description: 'The new content' }
            },
            required: ['targetFile', 'targetContent', 'replacementContent']
        },
        execute: async (args: { targetFile: string, targetContent: string, replacementContent: string }) => {
            // Approval Flow: Always ask for edits
            const approved = await commandApprovalService.requestApproval({
                command: `Edit ${args.targetFile}`,
                cwd: path.dirname(args.targetFile),
                safeToAutoRun: (args as any).safeToAutoRun || false,
                description: `Replacing content in: ${path.basename(args.targetFile)}`
            });

            if (!approved) {
                return { status: 'cancelled', message: 'File edit cancelled by user' };
            }

            const content = await fs.readFile(args.targetFile, 'utf8');
            if (!content.includes(args.targetContent)) {
                throw new Error('Target content not found in file');
            }
            const newContent = content.replace(args.targetContent, args.replacementContent);
            await fs.writeFile(args.targetFile, newContent, 'utf8');
            return {
                status: 'success',
                message: 'File updated successfully',
                fileName: path.basename(args.targetFile),
                path: args.targetFile
            };
        }
    },

    multiReplaceFileContent: {
        name: 'multi_replace_file_content',
        description: 'Replace multiple blocks of text in a file in one transaction',
        parameters: {
            type: 'object',
            properties: {
                targetFile: { type: 'string' },
                replacements: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            targetContent: { type: 'string' },
                            replacementContent: { type: 'string' }
                        }
                    }
                }
            },
            required: ['targetFile', 'replacements']
        },
        execute: async (args: { targetFile: string, replacements: any[] }) => {
            // Approval Flow: Always ask for edits
            const approved = await commandApprovalService.requestApproval({
                command: `Multi-Edit ${args.targetFile}`,
                cwd: path.dirname(args.targetFile),
                safeToAutoRun: (args as any).safeToAutoRun || false,
                description: `Applying ${args.replacements.length} changes to: ${path.basename(args.targetFile)}`
            });

            if (!approved) {
                return { status: 'cancelled', message: 'Multi-edit cancelled by user' };
            }

            let content = await fs.readFile(args.targetFile, 'utf8');
            for (const r of args.replacements) {
                if (!content.includes(r.targetContent)) {
                    throw new Error(`Target content "${r.targetContent}" not found`);
                }
                content = content.replace(r.targetContent, r.replacementContent);
            }
            await fs.writeFile(args.targetFile, content, 'utf8');
            return {
                status: 'success',
                message: 'Multi-replacement complete',
                fileName: path.basename(args.targetFile),
                path: args.targetFile
            };
        }
    },

    viewFileOutline: {
        name: 'view_file_outline',
        description: 'Get a hierarchical list of functions, classes, and methods in a file',
        parameters: {
            type: 'object',
            properties: {
                absolutePath: { type: 'string' }
            },
            required: ['absolutePath']
        },
        execute: async (args: { absolutePath: string }) => {
            try {
                const uri = vscode.Uri.file(args.absolutePath);
                // Ensure document is open for provider to work
                const doc = await vscode.workspace.openTextDocument(uri);

                // Use VS Code's native symbol provider (LSP)
                const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                    'vscode.executeDocumentSymbolProvider',
                    uri
                );

                if (!symbols || symbols.length === 0) {
                    return "No symbols found (Language server may not be ready or supported for this file type).";
                }

                const formatSymbol = (sym: vscode.DocumentSymbol, depth: number = 0): string => {
                    const indent = '  '.repeat(depth);
                    const kind = vscode.SymbolKind[sym.kind] || 'Symbol';
                    let output = `${indent}- [${kind}] ${sym.name} (Line ${sym.range.start.line + 1})`;
                    if (sym.children && sym.children.length > 0) {
                        output += '\n' + sym.children.map(child => formatSymbol(child, depth + 1)).join('\n');
                    }
                    return output;
                };

                return symbols.map(s => formatSymbol(s)).join('\n');
            } catch (e: any) {
                return `Failed to get outline: ${e.message}`;
            }
        }
    },

    findByName: {
        name: 'find_by_name',
        description: 'Find files by name using glob patterns',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Glob pattern like **/*.js' }
            },
            required: ['pattern']
        },
        execute: async (args: { pattern: string }) => {
            const files = await vscode.workspace.findFiles(args.pattern);
            return files.map(f => f.fsPath);
        }
    }
};
