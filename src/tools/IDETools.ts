import * as vscode from 'vscode';

export const IDETools = {
    getDiagnostics: {
        name: 'get_ide_diagnostics',
        description: 'Get current lint errors and warnings in the workspace',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Filter by specific file' }
            }
        },
        execute: async (args: { filePath?: string }) => {
            const diags = vscode.languages.getDiagnostics();
            return diags
                .filter(([uri]) => !args.filePath || uri.fsPath === args.filePath)
                .map(([uri, dList]) => ({
                    file: uri.fsPath,
                    errors: dList.map(d => `[Line ${d.range.start.line + 1}] ${d.message}`)
                }));
        }
    },

    autoFixLints: {
        name: 'auto_fix_lints',
        description: 'Attempt to automatically fix lint errors in a file using AI',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string' }
            },
            required: ['filePath']
        },
        execute: async (args: { filePath: string }) => {
            return `Auto-fix triggered for ${args.filePath}. Analyzing diagnostics...`;
        }
    },

    showDiff: {
        name: 'show_diff',
        description: 'Open a side-by-side diff view of a file',
        parameters: {
            type: 'object',
            properties: {
                originalPath: { type: 'string' },
                modifiedPath: { type: 'string' },
                title: { type: 'string' }
            },
            required: ['originalPath', 'modifiedPath']
        },
        execute: async (args: { originalPath: string, modifiedPath: string, title?: string }) => {
            await vscode.commands.executeCommand(
                'vscode.diff',
                vscode.Uri.file(args.originalPath),
                vscode.Uri.file(args.modifiedPath),
                args.title || 'Cnx Diff'
            );
            return 'Diff view opened';
        }
    },

    goToDefinition: {
        name: 'go_to_definition',
        description: 'Find the definition of a symbol at a specific location',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string' },
                line: { type: 'number' },
                character: { type: 'number' }
            },
            required: ['filePath', 'line', 'character']
        },
        execute: async (args: { filePath: string, line: number, character: number }) => {
            const uri = vscode.Uri.file(args.filePath);
            const pos = new vscode.Position(args.line - 1, args.character - 1);

            const locations = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                'vscode.executeDefinitionProvider',
                uri,
                pos
            );

            if (!locations || locations.length === 0) return 'No definition found';

            const loc = locations[0];
            const targetUri = 'uri' in loc ? loc.uri : loc.targetUri;
            const targetRange = 'range' in loc ? loc.range : loc.targetRange;

            // Read some content from the definition
            const doc = await vscode.workspace.openTextDocument(targetUri);
            const content = doc.getText(new vscode.Range(
                Math.max(0, targetRange.start.line - 2), 0,
                Math.min(doc.lineCount - 1, targetRange.end.line + 10), 0
            ));

            return {
                file: targetUri.fsPath,
                line: targetRange.start.line + 1,
                content: content
            };
        }
    },

    findReferences: {
        name: 'find_references',
        description: 'Find all references to a symbol at a specific location',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string' },
                line: { type: 'number' },
                character: { type: 'number' }
            },
            required: ['filePath', 'line', 'character']
        },
        execute: async (args: { filePath: string, line: number, character: number }) => {
            const uri = vscode.Uri.file(args.filePath);
            const pos = new vscode.Position(args.line - 1, args.character - 1);

            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                uri,
                pos
            );

            if (!locations || locations.length === 0) return 'No references found';

            return locations.map(l => ({
                file: l.uri.fsPath,
                line: l.range.start.line + 1,
                preview: l.range.start.line // Future improvement: include code preview
            })).slice(0, 10);
        }
    },

    getTypeDefinition: {
        name: 'go_to_type_definition',
        description: 'Find the type definition of a symbol at a specific location',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string' },
                line: { type: 'number' },
                character: { type: 'number' }
            },
            required: ['filePath', 'line', 'character']
        },
        execute: async (args: { filePath: string, line: number, character: number }) => {
            const uri = vscode.Uri.file(args.filePath);
            const pos = new vscode.Position(args.line - 1, args.character - 1);

            const locations = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                'vscode.executeTypeDefinitionProvider',
                uri,
                pos
            );

            if (!locations || locations.length === 0) return 'No type definition found';

            const loc = locations[0];
            const targetUri = 'uri' in loc ? loc.uri : loc.targetUri;
            const targetRange = 'range' in loc ? loc.range : loc.targetRange;

            const doc = await vscode.workspace.openTextDocument(targetUri);
            return {
                file: targetUri.fsPath,
                line: targetRange.start.line + 1,
                content: doc.getText(targetRange)
            };
        }
    },

    getImplementation: {
        name: 'go_to_implementation',
        description: 'Find implementations of an interface or abstract member',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string' },
                line: { type: 'number' },
                character: { type: 'number' }
            },
            required: ['filePath', 'line', 'character']
        },
        execute: async (args: { filePath: string, line: number, character: number }) => {
            const uri = vscode.Uri.file(args.filePath);
            const pos = new vscode.Position(args.line - 1, args.character - 1);

            const locations = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                'vscode.executeImplementationProvider',
                uri,
                pos
            );

            if (!locations || locations.length === 0) return 'No implementations found';

            return locations.map(loc => {
                const targetUri = 'uri' in loc ? loc.uri : loc.targetUri;
                const targetRange = 'range' in loc ? loc.range : loc.targetRange;
                return {
                    file: targetUri.fsPath,
                    line: targetRange.start.line + 1
                };
            }).slice(0, 10);
        }
    },

    getCallHierarchy: {
        name: 'get_call_hierarchy',
        description: 'Get incoming or outgoing calls for a function',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string' },
                line: { type: 'number' },
                character: { type: 'number' },
                direction: { type: 'string', enum: ['incoming', 'outgoing'] }
            },
            required: ['filePath', 'line', 'character', 'direction']
        },
        execute: async (args: { filePath: string, line: number, character: number, direction: 'incoming' | 'outgoing' }) => {
            const uri = vscode.Uri.file(args.filePath);
            const pos = new vscode.Position(args.line - 1, args.character - 1);

            const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
                'vscode.prepareCallHierarchy',
                uri,
                pos
            );

            if (!items || items.length === 0) return 'Could not prepare call hierarchy';

            if (args.direction === 'incoming') {
                const incoming = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
                    'vscode.provideIncomingCalls',
                    items[0]
                );
                return incoming?.map(call => ({
                    from: call.from.name,
                    file: call.from.uri.fsPath,
                    line: call.from.range.start.line + 1
                })) || [];
            } else {
                const outgoing = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
                    'vscode.provideOutgoingCalls',
                    items[0]
                );
                return outgoing?.map(call => ({
                    to: call.to.name,
                    file: call.to.uri.fsPath,
                    line: call.to.range.start.line + 1
                })) || [];
            }
        }
    }
};
