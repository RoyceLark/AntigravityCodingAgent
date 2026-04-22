import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export class ProjectGuidelinesProvider {
    /**
     * Locate and parse project-specific guidelines from root files
     */
    async getGuidelines(workspaceRoot: string): Promise<string> {
        let guidelines = "";
        const targetFiles = [
            'README.md',
            'CONTRIBUTING.md',
            '.agent/instructions.md',
            '.agent/rules.md',
            'DEVELOPMENT.md'
        ];

        for (const fileName of targetFiles) {
            try {
                const filePath = path.join(workspaceRoot, fileName);
                const content = await fs.readFile(filePath, 'utf8');

                // Extract key sections if too large (e.g., Guidelines, Standards, Architecture)
                guidelines += `\n### From ${fileName}:\n`;
                if (content.length > 2000) {
                    // Primitive extraction - looking for relevant headers
                    const lines = content.split('\n');
                    let inSection = false;
                    let sectionContent = "";

                    for (const line of lines) {
                        if (line.match(/^#+.*(Guideline|Standard|Architecture|Rule|Convention|Protocol)/i)) {
                            inSection = true;
                        } else if (line.match(/^#+/) && inSection) {
                            // inSection = false; // Keep looking for more sections
                        }

                        if (inSection && sectionContent.length < 1500) {
                            sectionContent += line + '\n';
                        }
                    }
                    guidelines += sectionContent || content.substring(0, 1000) + '... (truncated)';
                } else {
                    guidelines += content;
                }
            } catch (e) {
                // File not found, skip
            }
        }

        return guidelines || "No specific project guidelines found.";
    }
}
