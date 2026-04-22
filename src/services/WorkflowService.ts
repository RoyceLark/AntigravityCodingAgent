import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export class WorkflowService {
    private workflowDir: string = '.agent/workflows';

    constructor(private workspaceRoot: string) { }

    public async listWorkflows() {
        try {
            const workflowPath = path.join(this.workspaceRoot, this.workflowDir);
            const files = await fs.readdir(workflowPath);
            return files.filter(f => f.endsWith('.md'));
        } catch {
            return [];
        }
    }

    public async getWorkflow(name: string) {
        const workflowPath = path.join(this.workspaceRoot, this.workflowDir, name);
        try {
            return await fs.readFile(workflowPath, 'utf8');
        } catch {
            throw new Error(`Workflow ${name} not found`);
        }
    }

    public getTools() {
        return {
            list_workflows: {
                name: 'list_workflows',
                description: 'List all available automation workflows in the workspace',
                parameters: { type: 'object', properties: {} },
                execute: async () => this.listWorkflows()
            },
            read_workflow: {
                name: 'read_workflow',
                description: 'Read the steps of a specific workflow',
                parameters: {
                    type: 'object',
                    properties: { workflowName: { type: 'string' } },
                    required: ['workflowName']
                },
                execute: async (args: any) => this.getWorkflow(args.workflowName)
            }
        };
    }
}
