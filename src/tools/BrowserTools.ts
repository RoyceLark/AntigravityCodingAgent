import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

// Lazy-load playwright to avoid bundling issues
let chromium: any = null;

async function loadPlaywright() {
    if (!chromium) {
        try {
            const playwright = await import('playwright');
            chromium = playwright.chromium;
        } catch (error) {
            throw new Error('Playwright is not installed. Browser tools are not available. Install with: npm install playwright');
        }
    }
    return chromium;
}

export class BrowserTools {
    private browser: any = null;
    private page: any = null;
    private videoPath: string | null = null;

    public async ensureBrowser(recordVideo: boolean = false) {
        if (!this.browser) {
            const chromiumInstance = await loadPlaywright();
            const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || process.cwd();
            const recordDir = path.join(workspacePath, '.agent/recordings');

            this.browser = await chromiumInstance.launch({ headless: true });
            const context = await this.browser.newContext(recordVideo ? {
                recordVideo: { dir: recordDir, size: { width: 1280, height: 720 } }
            } : {});
            this.page = await context.newPage();
        }
        return this.page!;
    }

    public getTools() {
        return {
            open_url: {
                name: 'open_url',
                description: 'Open a URL in the browser and return the page content',
                parameters: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: 'The URL to open' },
                        record: { type: 'boolean', description: 'Whether to record the session as video' }
                    },
                    required: ['url']
                },
                execute: async (args: { url: string, record?: boolean }) => {
                    try {
                        const page = await this.ensureBrowser(args.record);
                        await page.goto(args.url, { waitUntil: 'networkidle' });
                        const content = await page.content();
                        return { url: args.url, content: content.substring(0, 5000) + "..." };
                    } catch (error: any) {
                        return { error: error.message };
                    }
                }
            },
            click_element: {
                name: 'click_element',
                description: 'Click an element on the current page',
                parameters: {
                    type: 'object',
                    properties: {
                        selector: { type: 'string', description: 'CSS selector of the element' }
                    },
                    required: ['selector']
                },
                execute: async (args: { selector: string }) => {
                    try {
                        const page = await this.ensureBrowser();
                        await page.click(args.selector);
                        return `Clicked ${args.selector}`;
                    } catch (error: any) {
                        return { error: error.message };
                    }
                }
            },
            screenshot: {
                name: 'screenshot',
                description: 'Take a screenshot of the current page',
                parameters: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Name of the screenshot file' }
                    },
                    required: ['name']
                },
                execute: async (args: { name: string }) => {
                    try {
                        const page = await this.ensureBrowser();
                        const filePath = path.join(process.cwd(), `${args.name}.png`);
                        await page.screenshot({ path: filePath });
                        return `Screenshot saved to ${filePath}`;
                    } catch (error: any) {
                        return { error: error.message };
                    }
                }
            }
        };
    }

    public async cleanup() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }
}
