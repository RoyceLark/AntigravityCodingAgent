import * as vscode from 'vscode';
import { ArtifactManager } from '../services/ArtifactManager';

export class PlanTools {
    constructor(private artifactManager: ArtifactManager, private getConversationId: () => string) { }

    public getTools() {
        return {
            create_implementation_plan: {
                name: 'create_implementation_plan',
                description: 'Create a structured implementation plan from requirements. This helps track progress, features, and pending tasks.',
                parameters: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: 'Title of the plan (e.g., "Add User Authentication")' },
                        requirements: { type: 'string', description: 'Summary of the requirements to be implemented' },
                        tasks: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'number', description: 'Unique task ID within this plan' },
                                    title: { type: 'string', description: 'Brief title of the task' },
                                    description: { type: 'string', description: 'Detailed description of what needs to be done' },
                                    status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], default: 'pending' }
                                },
                                required: ['id', 'title']
                            },
                        }
                    },
                    required: ['title', 'tasks']
                },
                execute: async (args: any) => {
                    const artifact = await this.artifactManager.createArtifact(
                        args.title,
                        JSON.stringify(args, null, 2),
                        'implementation_plan',
                        args.requirements || `Implementation plan for ${args.title}`,
                        5,
                        this.getConversationId()
                    );
                    return {
                        message: 'Implementation plan created successfully. The UI will now track these tasks.',
                        planId: artifact.metadata.id,
                        artifact: artifact
                    };
                }
            },
            update_task_status: {
                name: 'update_task_status',
                description: 'Update the status of a specific task in an implementation plan.',
                parameters: {
                    type: 'object',
                    properties: {
                        planId: { type: 'string', description: 'The ID of the plan artifact' },
                        taskId: { type: 'number', description: 'The ID of the task to update' },
                        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
                    },
                    required: ['planId', 'taskId', 'status']
                },
                execute: async (args: any) => {
                    const artifact = this.artifactManager.getArtifact(args.planId);
                    if (!artifact) return { error: 'Plan not found' };

                    try {
                        const data = JSON.parse(artifact.content);
                        const task = data.tasks.find((t: any) => t.id === args.taskId);
                        if (!task) return { error: 'Task not found in plan' };

                        task.status = args.status;

                        const updatedArtifact = await this.artifactManager.updateArtifact(args.planId, {
                            content: JSON.stringify(data, null, 2),
                            summary: `Updated plan: ${data.tasks.filter((t: any) => t.status === 'completed').length}/${data.tasks.length} tasks completed`
                        });

                        return {
                            message: `Task ${args.taskId} updated to ${args.status}`,
                            artifact: updatedArtifact
                        };
                    } catch (e) {
                        return { error: 'Failed to update plan: ' + (e as Error).message };
                    }
                }
            }
        };
    }
}
