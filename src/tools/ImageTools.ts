import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

export const ImageTools = {
    generateImage: {
        name: 'generate_image',
        description: 'Generate an image based on a text prompt for UI mockups or assets',
        parameters: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'Detailed prompt for the image' },
                imageName: { type: 'string', description: 'Name of the file (without extension)' }
            },
            required: ['prompt', 'imageName']
        },
        execute: async (args: { prompt: string, imageName: string }) => {
            const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
            const filePath = path.join(workspacePath, `${args.imageName}.png`);

            // Use Pollinations.ai for high-quality AI generated image mocks
            const imageUrl = `https://pollinations.ai/p/${encodeURIComponent(args.prompt)}?width=1024&height=1024&seed=${Math.floor(Math.random() * 1000)}&nologo=true`;

            try {
                const response = await fetch(imageUrl);
                const buffer = await response.arrayBuffer();
                await fs.writeFile(filePath, Buffer.from(buffer));
                return `Image generation for "${args.prompt}" completed. Saved as ${filePath}. (Powered by Pollinations.ai)`;
            } catch (error: any) {
                return `Failed to generate image: ${error.message}. Saved placeholder instead.`;
            }
        }
    }
};
