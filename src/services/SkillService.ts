import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export class SkillService {
    private skillDir: string = '.agent/skills';

    constructor(private workspaceRoot: string) { }

    public async listSkills() {
        try {
            const skillPath = path.join(this.workspaceRoot, this.skillDir);
            const dirs = await fs.readdir(skillPath, { withFileTypes: true });
            return dirs.filter(d => d.isDirectory()).map(d => d.name);
        } catch {
            return [];
        }
    }

    public async getSkillInstructions(skillName: string) {
        const skillPath = path.join(this.workspaceRoot, this.skillDir, skillName, 'SKILL.md');
        try {
            return await fs.readFile(skillPath, 'utf8');
        } catch {
            throw new Error(`Skill ${skillName} instructions not found`);
        }
    }

    public getTools() {
        return {
            list_skills: {
                name: 'list_skills',
                description: 'List available specialized skills in the workspace',
                parameters: { type: 'object', properties: {} },
                execute: async () => this.listSkills()
            },
            view_skill_help: {
                name: 'view_skill_help',
                description: 'View full instructions for a specific skill',
                parameters: {
                    type: 'object',
                    properties: { skillName: { type: 'string' } },
                    required: ['skillName']
                },
                execute: async (args: any) => this.getSkillInstructions(args.skillName)
            }
        };
    }
}
