import * as vscode from 'vscode';

export const IDETerminalTools = {
    createTerminal: {
        name: 'create_terminal',
        description: 'Create a new integrated terminal in VS Code',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name for the terminal' }
            }
        },
        execute: async (args: { name?: string }) => {
            const terminal = vscode.window.createTerminal(args.name || 'Cnx');
            terminal.show();
            return `Terminal "${terminal.name}" created and shown.`;
        }
    },

    sendToTerminal: {
        name: 'send_to_terminal',
        description: 'Send a command string to an existing integrated terminal',
        parameters: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Command or text to send' },
                terminalName: { type: 'string', description: 'Name of the terminal (optional)' },
                addNewLine: { type: 'boolean', description: 'Whether to execute (add \n)' }
            },
            required: ['text']
        },
        execute: async (args: { text: string, terminalName?: string, addNewLine?: boolean }) => {
            let terminal = vscode.window.terminals.find(t => t.name === args.terminalName);
            if (!terminal) {
                terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Cnx');
            }
            terminal.sendText(args.text, args.addNewLine !== false);
            terminal.show();
            return `Sent text to terminal "${terminal.name}".`;
        }
    },

    listTerminals: {
        name: 'list_terminals',
        description: 'List all open integrated terminals',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
            return vscode.window.terminals.map(t => ({
                name: t.name,
                processId: t.processId
            }));
        }
    }
};
