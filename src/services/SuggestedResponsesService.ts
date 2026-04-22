/**
 * Suggested Responses Service
 * Generates contextual suggested responses based on conversation state
 */

export interface SuggestedResponse {
    text: string;
    description: string;
    icon?: string;
    category: 'quick_action' | 'clarification' | 'follow_up' | 'command';
}

export class SuggestedResponsesService {
    /**
     * Generate suggested responses based on context
     */
    generateSuggestions(context: {
        lastMessage?: string;
        hasErrors?: boolean;
        hasToolCalls?: boolean;
        hasCodeChanges?: boolean;
        activeFile?: string;
        hasSelection?: boolean;
    }): SuggestedResponse[] {
        const suggestions: SuggestedResponse[] = [];

        // Error-related suggestions
        if (context.hasErrors) {
            suggestions.push({
                text: 'Explain the error',
                description: 'Get a detailed explanation of what went wrong',
                icon: '❓',
                category: 'clarification'
            });
            suggestions.push({
                text: 'Suggest a fix',
                description: 'Get recommendations to resolve the error',
                icon: '🔧',
                category: 'follow_up'
            });
            suggestions.push({
                text: 'Try a different approach',
                description: 'Explore alternative solutions',
                icon: '🔄',
                category: 'follow_up'
            });
        }

        // Code change suggestions
        if (context.hasCodeChanges) {
            suggestions.push({
                text: 'Add tests for this code',
                description: 'Generate unit tests',
                icon: '🧪',
                category: 'follow_up'
            });
            suggestions.push({
                text: 'Add documentation',
                description: 'Generate comments and docs',
                icon: '📝',
                category: 'follow_up'
            });
            suggestions.push({
                text: 'Review for improvements',
                description: 'Get code review suggestions',
                icon: '👀',
                category: 'follow_up'
            });
        }

        // Tool execution suggestions
        if (context.hasToolCalls) {
            suggestions.push({
                text: 'Explain what you did',
                description: 'Get a summary of the actions taken',
                icon: '📋',
                category: 'clarification'
            });
            suggestions.push({
                text: 'Show me the changes',
                description: 'View a diff of what changed',
                icon: '🔍',
                category: 'quick_action'
            });
        }

        // Active file suggestions
        if (context.activeFile) {
            suggestions.push({
                text: 'Explain this file',
                description: 'Get an overview of the current file',
                icon: '📄',
                category: 'quick_action'
            });
            suggestions.push({
                text: 'Refactor this code',
                description: 'Improve code structure and quality',
                icon: '♻️',
                category: 'quick_action'
            });

            if (context.hasSelection) {
                suggestions.push({
                    text: 'Explain selection',
                    description: 'Explain the selected code',
                    icon: '💡',
                    category: 'quick_action'
                });
                suggestions.push({
                    text: 'Optimize selection',
                    description: 'Improve the selected code',
                    icon: '⚡',
                    category: 'quick_action'
                });
            }
        }

        // General quick actions
        if (suggestions.length < 3) {
            suggestions.push(
                {
                    text: 'Search the web',
                    description: 'Search for information online',
                    icon: '🌐',
                    category: 'command'
                },
                {
                    text: 'Create a new file',
                    description: 'Generate a new code file',
                    icon: '📄',
                    category: 'command'
                },
                {
                    text: 'Run tests',
                    description: 'Execute test suite',
                    icon: '🧪',
                    category: 'command'
                }
            );
        }

        // Limit to 6 suggestions
        return suggestions.slice(0, 6);
    }

    /**
     * Generate follow-up questions based on last response
     */
    generateFollowUpQuestions(lastResponse: string): SuggestedResponse[] {
        const questions: SuggestedResponse[] = [];

        // Detect if response contains code
        if (lastResponse.includes('```')) {
            questions.push({
                text: 'Can you explain this code?',
                description: 'Get a detailed explanation',
                icon: '💭',
                category: 'clarification'
            });
            questions.push({
                text: 'Are there any edge cases?',
                description: 'Identify potential issues',
                icon: '⚠️',
                category: 'clarification'
            });
        }

        // Detect if response contains file paths
        if (lastResponse.match(/[a-zA-Z]:\\[\\\w\.\/-]+|(?:\/|.\/)[\w\.\/-]+/)) {
            questions.push({
                text: 'Show me the file structure',
                description: 'View related files',
                icon: '📁',
                category: 'follow_up'
            });
        }

        // Detect if response mentions errors or issues
        if (lastResponse.toLowerCase().includes('error') ||
            lastResponse.toLowerCase().includes('issue') ||
            lastResponse.toLowerCase().includes('problem')) {
            questions.push({
                text: 'How can I debug this?',
                description: 'Get debugging strategies',
                icon: '🐛',
                category: 'follow_up'
            });
        }

        // Detect if response mentions implementation
        if (lastResponse.toLowerCase().includes('implement') ||
            lastResponse.toLowerCase().includes('create') ||
            lastResponse.toLowerCase().includes('add')) {
            questions.push({
                text: 'What are the next steps?',
                description: 'Get implementation guidance',
                icon: '➡️',
                category: 'follow_up'
            });
        }

        return questions.slice(0, 4);
    }

    /**
     * Generate context-aware quick commands
     */
    generateQuickCommands(workspaceType?: 'node' | 'python' | 'java' | 'other'): SuggestedResponse[] {
        const commands: SuggestedResponse[] = [
            {
                text: '/help',
                description: 'Show available commands',
                icon: '❓',
                category: 'command'
            },
            {
                text: '/clear',
                description: 'Clear conversation history',
                icon: '🗑️',
                category: 'command'
            }
        ];

        // Workspace-specific commands
        if (workspaceType === 'node') {
            commands.push(
                {
                    text: 'npm install',
                    description: 'Install dependencies',
                    icon: '📦',
                    category: 'command'
                },
                {
                    text: 'npm test',
                    description: 'Run tests',
                    icon: '🧪',
                    category: 'command'
                }
            );
        } else if (workspaceType === 'python') {
            commands.push(
                {
                    text: 'pip install -r requirements.txt',
                    description: 'Install dependencies',
                    icon: '📦',
                    category: 'command'
                },
                {
                    text: 'pytest',
                    description: 'Run tests',
                    icon: '🧪',
                    category: 'command'
                }
            );
        }

        return commands;
    }

    /**
     * Generate smart suggestions based on file type
     */
    generateFileTypeSuggestions(fileName: string): SuggestedResponse[] {
        const ext = fileName.split('.').pop()?.toLowerCase();
        const suggestions: SuggestedResponse[] = [];

        switch (ext) {
            case 'ts':
            case 'js':
                suggestions.push(
                    {
                        text: 'Add TypeScript types',
                        description: 'Improve type safety',
                        icon: '🔷',
                        category: 'quick_action'
                    },
                    {
                        text: 'Convert to async/await',
                        description: 'Modernize async code',
                        icon: '⚡',
                        category: 'quick_action'
                    }
                );
                break;
            case 'py':
                suggestions.push(
                    {
                        text: 'Add type hints',
                        description: 'Add Python type annotations',
                        icon: '🔷',
                        category: 'quick_action'
                    },
                    {
                        text: 'Add docstrings',
                        description: 'Document functions',
                        icon: '📝',
                        category: 'quick_action'
                    }
                );
                break;
            case 'java':
                suggestions.push(
                    {
                        text: 'Add JavaDoc',
                        description: 'Generate documentation',
                        icon: '📝',
                        category: 'quick_action'
                    },
                    {
                        text: 'Apply design patterns',
                        description: 'Improve architecture',
                        icon: '🏗️',
                        category: 'quick_action'
                    }
                );
                break;
        }

        return suggestions;
    }
}
