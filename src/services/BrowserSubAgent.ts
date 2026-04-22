import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

// Lazy-load playwright to avoid bundling issues
let playwright: any = null;

async function loadPlaywright() {
    if (!playwright) {
        try {
            playwright = await import('playwright');
        } catch (error) {
            throw new Error('Playwright not installed. Run: npm install playwright');
        }
    }
    return playwright;
}

/**
 * Represents a single test step in a browser test flow
 */
export interface BrowserTestStep {
    /** The action to perform */
    action: 'navigate' | 'click' | 'type' | 'screenshot' | 'wait' | 'assert_text' | 'assert_element' | 'scroll' | 'hover' | 'select' | 'fill';
    /** CSS selector or URL for the target */
    target?: string;
    /** Value for type, fill, or assertion actions */
    value?: string;
    /** Human-readable description of the step */
    description: string;
    /** Timeout in milliseconds (default: 5000) */
    timeout?: number;
}

/**
 * Result of a single test step execution
 */
export interface BrowserTestResult {
    stepIndex: number;
    step: BrowserTestStep;
    status: 'passed' | 'failed' | 'skipped';
    screenshotPath?: string;
    screenshotBase64?: string;
    error?: string;
    duration: number;
    timestamp: Date;
}

/**
 * Screenshot metadata stored in reports
 */
export interface ScreenshotMetadata {
    name: string;
    path: string;
    base64?: string;
    timestamp: Date;
    stepIndex?: number;
}

/**
 * Complete test report with all results and metadata
 */
export interface BrowserTestReport {
    id: string;
    agentId: string;
    url: string;
    title: string;
    steps: BrowserTestResult[];
    overallStatus: 'passed' | 'failed' | 'partial';
    totalDuration: number;
    startedAt: Date;
    completedAt: Date;
    screenshots: ScreenshotMetadata[];
    consoleErrors: string[];
    networkErrors: string[];
}

/**
 * Configuration options for browser initialization
 */
export interface BrowserInitOptions {
    headless?: boolean;
    viewport?: { width: number; height: number };
    recordVideo?: boolean;
    recordTrace?: boolean;
}

/**
 * Event emitted when a test step completes
 */
export interface StepCompleteEvent {
    stepIndex: number;
    result: BrowserTestResult;
}

/**
 * Event emitted when an entire test flow completes
 */
export interface TestCompleteEvent {
    report: BrowserTestReport;
}

/**
 * Production-grade Browser Sub-Agent for autonomous browser testing and validation
 * Implements Google Antigravity-style sub-agents with autonomous test execution
 */
export class BrowserSubAgent {
    private browser: any = null;
    private context: any = null;
    private page: any = null;
    private screenshotDir: string;
    private videoDir: string;
    private traceDir: string;
    private consoleMessages: string[] = [];
    private networkErrors: string[] = [];
    private _onStepComplete: vscode.EventEmitter<StepCompleteEvent>;
    private _onTestComplete: vscode.EventEmitter<TestCompleteEvent>;
    private isInitialized: boolean = false;
    private DEFAULT_TIMEOUT = 5000;
    private NETWORK_IDLE_TIMEOUT = 3000;

    constructor(private workspaceDir: string = process.cwd()) {
        this.screenshotDir = path.join(workspaceDir, '.agent', 'screenshots');
        this.videoDir = path.join(workspaceDir, '.agent', 'recordings');
        this.traceDir = path.join(workspaceDir, '.agent', 'traces');
        this._onStepComplete = new vscode.EventEmitter<StepCompleteEvent>();
        this._onTestComplete = new vscode.EventEmitter<TestCompleteEvent>();
        console.log(`BrowserSubAgent: Initialized with workspace ${workspaceDir}`);
    }

    /**
     * Event emitter for step completion
     */
    get onStepComplete() {
        return this._onStepComplete.event;
    }

    /**
     * Event emitter for test completion
     */
    get onTestComplete() {
        return this._onTestComplete.event;
    }

    /**
     * Initialize the browser with specified options
     */
    async initialize(options?: BrowserInitOptions): Promise<void> {
        if (this.isInitialized) {
            console.log('BrowserSubAgent: Already initialized');
            return;
        }

        try {
            console.log('BrowserSubAgent: Initializing browser...');

            // Ensure directories exist
            await this.ensureDirectories();

            // Load playwright
            const pw = await loadPlaywright();

            // Launch browser
            const launchOptions = {
                headless: options?.headless !== false,
            };

            this.browser = await pw.chromium.launch(launchOptions);
            console.log('BrowserSubAgent: Browser launched');

            // Create context with optional recording
            const contextOptions: any = {
                viewport: options?.viewport || { width: 1280, height: 720 },
            };

            if (options?.recordVideo) {
                contextOptions.recordVideo = {
                    dir: this.videoDir,
                    size: { width: 1280, height: 720 }
                };
                console.log('BrowserSubAgent: Video recording enabled');
            }

            if (options?.recordTrace) {
                contextOptions.recordTrace = {
                    dir: this.traceDir,
                    sources: true,
                    snapshots: true
                };
                console.log('BrowserSubAgent: Trace recording enabled');
            }

            this.context = await this.browser.newContext(contextOptions);

            // Create page
            this.page = await this.context.newPage();
            this.isInitialized = true;

            // Setup page event listeners
            this.setupPageListeners();

            console.log('BrowserSubAgent: Initialization complete');
        } catch (error: any) {
            console.error('BrowserSubAgent: Initialization failed', error);
            throw error;
        }
    }

    /**
     * Setup event listeners for page to capture console and network errors
     */
    private setupPageListeners(): void {
        if (!this.page) return;

        // Capture console messages
        this.page.on('console', (msg: any) => {
            const logEntry = `[${msg.type().toUpperCase()}] ${msg.text()}`;
            this.consoleMessages.push(logEntry);

            if (msg.type() === 'error') {
                console.error(`BrowserSubAgent: Console error: ${msg.text()}`);
            }
        });

        // Capture uncaught exceptions
        this.page.on('pageerror', (error: any) => {
            const errorMsg = `Uncaught exception: ${error.message}`;
            this.consoleMessages.push(errorMsg);
            console.error(`BrowserSubAgent: ${errorMsg}`);
        });

        // Capture failed requests
        this.page.on('requestfailed', (request: any) => {
            const failureMsg = `Request failed: ${request.method()} ${request.url()} - ${request.failure().errorText}`;
            this.networkErrors.push(failureMsg);
            console.warn(`BrowserSubAgent: ${failureMsg}`);
        });

        // Capture response errors (4xx, 5xx)
        this.page.on('response', (response: any) => {
            if (response.status() >= 400) {
                const errorMsg = `HTTP ${response.status()}: ${response.request().method()} ${response.url()}`;
                this.networkErrors.push(errorMsg);
                if (response.status() >= 500) {
                    console.error(`BrowserSubAgent: ${errorMsg}`);
                }
            }
        });
    }

    /**
     * Ensure all required directories exist
     */
    private async ensureDirectories(): Promise<void> {
        try {
            await fs.mkdir(this.screenshotDir, { recursive: true });
            await fs.mkdir(this.videoDir, { recursive: true });
            await fs.mkdir(this.traceDir, { recursive: true });
        } catch (error: any) {
            console.warn(`BrowserSubAgent: Failed to create directories: ${error.message}`);
        }
    }

    /**
     * Execute an entire test flow autonomously
     */
    async runTestFlow(
        agentId: string,
        url: string,
        steps: BrowserTestStep[],
        title?: string
    ): Promise<BrowserTestReport> {
        if (!this.isInitialized) {
            throw new Error('BrowserSubAgent not initialized. Call initialize() first.');
        }

        const reportId = uuidv4();
        const startTime = Date.now();
        const startedAt = new Date();
        const results: BrowserTestResult[] = [];
        let overallStatus: 'passed' | 'failed' | 'partial' = 'passed';
        let stepsFailed = 0;
        let stepsSkipped = 0;

        console.log(`BrowserSubAgent: Starting test flow "${title || 'Unnamed'}" (ID: ${reportId})`);
        console.log(`BrowserSubAgent: Target URL: ${url}`);
        console.log(`BrowserSubAgent: Total steps: ${steps.length}`);

        try {
            // Navigate to initial URL
            console.log(`BrowserSubAgent: Navigating to ${url}`);
            await this.page!.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            console.log('BrowserSubAgent: Navigation complete');

            // Take initial screenshot
            const initialScreenshot = await this.takeScreenshot(`step-0-initial`);

            // Execute each step
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                const stepStartTime = Date.now();

                try {
                    console.log(`BrowserSubAgent: Executing step ${i + 1}/${steps.length}: ${step.description}`);

                    const result = await this.executeStep(step);
                    result.stepIndex = i;
                    result.duration = Date.now() - stepStartTime;
                    result.timestamp = new Date();

                    results.push(result);

                    if (result.status === 'failed') {
                        stepsFailed++;
                        overallStatus = 'partial';
                        console.error(`BrowserSubAgent: Step ${i + 1} FAILED: ${result.error}`);
                    } else if (result.status === 'skipped') {
                        stepsSkipped++;
                        console.warn(`BrowserSubAgent: Step ${i + 1} SKIPPED`);
                    } else {
                        console.log(`BrowserSubAgent: Step ${i + 1} PASSED (${result.duration}ms)`);
                    }

                    // Emit step complete event
                    this._onStepComplete.fire({
                        stepIndex: i,
                        result
                    });

                    // Small delay between steps for stability
                    await this.delay(100);

                } catch (error: any) {
                    stepsFailed++;
                    overallStatus = 'partial';
                    const errorMsg = error.message || 'Unknown error';

                    console.error(`BrowserSubAgent: Step ${i + 1} ERROR: ${errorMsg}`);

                    // Take error screenshot
                    const errorScreenshot = await this.takeScreenshot(`step-${i + 1}-error`);

                    results.push({
                        stepIndex: i,
                        step,
                        status: 'failed',
                        error: errorMsg,
                        screenshotPath: errorScreenshot.path,
                        screenshotBase64: errorScreenshot.base64,
                        duration: Date.now() - stepStartTime,
                        timestamp: new Date()
                    });

                    // Continue with next step instead of stopping
                    continue;
                }
            }

            // Check if all steps failed
            if (stepsFailed === steps.length) {
                overallStatus = 'failed';
            }

        } catch (error: any) {
            overallStatus = 'failed';
            console.error(`BrowserSubAgent: Test flow failed with fatal error: ${error.message}`);
        }

        // Compile all screenshots
        const screenshots = await this.compileScreenshots(results);

        const totalDuration = Date.now() - startTime;
        const completedAt = new Date();

        // Create report
        const report: BrowserTestReport = {
            id: reportId,
            agentId,
            url,
            title: title || 'Untitled Test Flow',
            steps: results,
            overallStatus,
            totalDuration,
            startedAt,
            completedAt,
            screenshots,
            consoleErrors: this.consoleMessages.filter(m => m.includes('[ERROR]')),
            networkErrors: this.networkErrors
        };

        // Log summary
        this.logTestSummary(report);

        // Emit test complete event
        this._onTestComplete.fire({
            report
        });

        return report;
    }

    /**
     * Execute a single test step
     */
    async executeStep(step: BrowserTestStep): Promise<BrowserTestResult> {
        const timeout = step.timeout || this.DEFAULT_TIMEOUT;
        const startTime = Date.now();

        try {
            // Take before screenshot
            const beforeScreenshot = await this.takeScreenshot(`${step.action}-before`);

            let result: BrowserTestResult = {
                stepIndex: 0,
                step,
                status: 'passed',
                screenshotPath: beforeScreenshot.path,
                screenshotBase64: beforeScreenshot.base64,
                duration: 0,
                timestamp: new Date()
            };

            switch (step.action) {
                case 'navigate':
                    if (!step.target) throw new Error('navigate action requires target URL');
                    await this.page!.goto(step.target, { waitUntil: 'networkidle', timeout: Math.min(timeout * 2, 30000) });
                    break;

                case 'click':
                    if (!step.target) throw new Error('click action requires target selector');
                    await this.page!.waitForSelector(step.target, { timeout });
                    await this.page!.click(step.target);
                    break;

                case 'type':
                    if (!step.target) throw new Error('type action requires target selector');
                    if (!step.value) throw new Error('type action requires value');
                    await this.page!.waitForSelector(step.target, { timeout });
                    await this.page!.fill(step.target, ''); // Clear first
                    await this.page!.type(step.target, step.value, { delay: 50 });
                    break;

                case 'fill':
                    if (!step.target) throw new Error('fill action requires target selector');
                    if (!step.value === undefined) throw new Error('fill action requires value');
                    await this.page!.waitForSelector(step.target, { timeout });
                    await this.page!.fill(step.target, step.value!);
                    break;

                case 'select':
                    if (!step.target) throw new Error('select action requires target selector');
                    if (!step.value) throw new Error('select action requires value');
                    await this.page!.waitForSelector(step.target, { timeout });
                    await this.page!.selectOption(step.target, step.value);
                    break;

                case 'scroll':
                    if (!step.target) throw new Error('scroll action requires target selector');
                    await this.page!.waitForSelector(step.target, { timeout });
                    await this.page!.locator(step.target).scrollIntoViewIfNeeded();
                    break;

                case 'hover':
                    if (!step.target) throw new Error('hover action requires target selector');
                    await this.page!.waitForSelector(step.target, { timeout });
                    await this.page!.hover(step.target);
                    break;

                case 'wait':
                    if (!step.value) throw new Error('wait action requires value (milliseconds)');
                    await this.delay(parseInt(step.value, 10));
                    break;

                case 'screenshot':
                    // Take explicit screenshot
                    const screenshotName = step.target || `screenshot-${Date.now()}`;
                    result.screenshotPath = (await this.takeScreenshot(screenshotName)).path;
                    break;

                case 'assert_element':
                    if (!step.target) throw new Error('assert_element action requires target selector');
                    const elementExists = await this.assertElement(step.target, timeout);
                    if (!elementExists) {
                        throw new Error(`Element not found: ${step.target}`);
                    }
                    break;

                case 'assert_text':
                    if (!step.target) throw new Error('assert_text action requires target selector');
                    if (!step.value) throw new Error('assert_text action requires value (expected text)');
                    const textMatches = await this.assertText(step.target, step.value, timeout);
                    if (!textMatches) {
                        throw new Error(`Expected text "${step.value}" not found in ${step.target}`);
                    }
                    break;

                default:
                    throw new Error(`Unknown action: ${step.action}`);
            }

            // Take after screenshot
            const afterScreenshot = await this.takeScreenshot(`${step.action}-after`);
            result.screenshotPath = afterScreenshot.path;
            result.screenshotBase64 = afterScreenshot.base64;
            result.duration = Date.now() - startTime;
            result.timestamp = new Date();

            return result;

        } catch (error: any) {
            // Take error screenshot
            const errorScreenshot = await this.takeScreenshot(`${step.action}-error`);

            return {
                stepIndex: 0,
                step,
                status: 'failed',
                error: error.message,
                screenshotPath: errorScreenshot.path,
                screenshotBase64: errorScreenshot.base64,
                duration: Date.now() - startTime,
                timestamp: new Date()
            };
        }
    }

    /**
     * Take a screenshot and return both file path and base64
     */
    async takeScreenshot(name: string): Promise<{ path: string; base64: string }> {
        if (!this.page) {
            throw new Error('Page not available');
        }

        try {
            // Sanitize name
            const sanitizedName = name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
            const timestamp = Date.now();
            const filename = `${sanitizedName}-${timestamp}.png`;
            const filepath = path.join(this.screenshotDir, filename);

            // Take screenshot
            const buffer = await this.page.screenshot({ path: filepath, fullPage: false });
            const base64 = buffer.toString('base64');

            console.log(`BrowserSubAgent: Screenshot saved: ${filepath}`);

            return {
                path: filepath,
                base64
            };
        } catch (error: any) {
            console.error(`BrowserSubAgent: Failed to take screenshot: ${error.message}`);
            throw error;
        }
    }

    /**
     * Assert that an element exists on the page
     */
    async assertElement(selector: string, timeout: number = this.DEFAULT_TIMEOUT): Promise<boolean> {
        if (!this.page) {
            throw new Error('Page not available');
        }

        try {
            await this.page.waitForSelector(selector, { timeout });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Assert that an element contains specific text
     */
    async assertText(selector: string, expectedText: string, timeout: number = this.DEFAULT_TIMEOUT): Promise<boolean> {
        if (!this.page) {
            throw new Error('Page not available');
        }

        try {
            const element = await this.page.waitForSelector(selector, { timeout });
            const text = await element.textContent();
            return text ? text.includes(expectedText) : false;
        } catch {
            return false;
        }
    }

    /**
     * Get full page HTML content
     */
    async getPageContent(): Promise<string> {
        if (!this.page) {
            throw new Error('Page not available');
        }
        return await this.page.content();
    }

    /**
     * Get all console errors from the page
     */
    async getConsoleErrors(): Promise<string[]> {
        return this.consoleMessages.filter(m => m.includes('[ERROR]'));
    }

    /**
     * Wait for network activity to stabilize
     */
    async waitForNetworkIdle(timeout: number = this.NETWORK_IDLE_TIMEOUT): Promise<void> {
        if (!this.page) {
            throw new Error('Page not available');
        }

        try {
            await this.page.waitForLoadState('networkidle', { timeout });
        } catch (error: any) {
            console.warn(`BrowserSubAgent: Network idle timeout after ${timeout}ms`);
        }
    }

    /**
     * Compile all screenshots from test results
     */
    private async compileScreenshots(results: BrowserTestResult[]): Promise<ScreenshotMetadata[]> {
        const screenshots: ScreenshotMetadata[] = [];

        for (const result of results) {
            if (result.screenshotPath) {
                try {
                    const filename = path.basename(result.screenshotPath);
                    let base64 = result.screenshotBase64;

                    // Read from file if not already cached
                    if (!base64) {
                        const buffer = await fs.readFile(result.screenshotPath);
                        base64 = buffer.toString('base64');
                    }

                    screenshots.push({
                        name: filename,
                        path: result.screenshotPath,
                        base64,
                        timestamp: result.timestamp,
                        stepIndex: result.stepIndex
                    });
                } catch (error: any) {
                    console.warn(`BrowserSubAgent: Failed to compile screenshot ${result.screenshotPath}: ${error.message}`);
                }
            }
        }

        return screenshots;
    }

    /**
     * Log test summary to console
     */
    private logTestSummary(report: BrowserTestReport): void {
        const passedCount = report.steps.filter(s => s.status === 'passed').length;
        const failedCount = report.steps.filter(s => s.status === 'failed').length;
        const skippedCount = report.steps.filter(s => s.status === 'skipped').length;

        console.log('\n' + '='.repeat(60));
        console.log(`BrowserSubAgent: Test Report - ${report.title}`);
        console.log('='.repeat(60));
        console.log(`Overall Status: ${report.overallStatus.toUpperCase()}`);
        console.log(`Duration: ${report.totalDuration}ms`);
        console.log(`Passed: ${passedCount}/${report.steps.length}`);
        console.log(`Failed: ${failedCount}/${report.steps.length}`);
        console.log(`Skipped: ${skippedCount}/${report.steps.length}`);
        console.log(`Screenshots: ${report.screenshots.length}`);
        console.log(`Console Errors: ${report.consoleErrors.length}`);
        console.log(`Network Errors: ${report.networkErrors.length}`);
        console.log('='.repeat(60) + '\n');

        if (failedCount > 0) {
            console.log('Failed Steps:');
            report.steps.forEach((step, i) => {
                if (step.status === 'failed') {
                    console.log(`  ${i + 1}. ${step.step.description}: ${step.error}`);
                }
            });
            console.log();
        }
    }

    /**
     * Save test report to file (JSON format)
     */
    async saveReport(report: BrowserTestReport, outputPath?: string): Promise<string> {
        try {
            const filename = outputPath || path.join(this.screenshotDir, `report-${report.id}.json`);

            // Ensure directory exists
            await fs.mkdir(path.dirname(filename), { recursive: true });

            // Serialize report
            const serialized = {
                ...report,
                startedAt: report.startedAt.toISOString(),
                completedAt: report.completedAt.toISOString(),
                steps: report.steps.map(s => ({
                    ...s,
                    timestamp: s.timestamp.toISOString()
                })),
                screenshots: report.screenshots.map(s => ({
                    ...s,
                    timestamp: s.timestamp.toISOString()
                }))
            };

            await fs.writeFile(filename, JSON.stringify(serialized, null, 2), 'utf-8');
            console.log(`BrowserSubAgent: Report saved to ${filename}`);

            return filename;
        } catch (error: any) {
            console.error(`BrowserSubAgent: Failed to save report: ${error.message}`);
            throw error;
        }
    }

    /**
     * Export report to HTML for easy viewing
     */
    async exportReportHTML(report: BrowserTestReport, outputPath?: string): Promise<string> {
        try {
            const filename = outputPath || path.join(this.screenshotDir, `report-${report.id}.html`);

            // Ensure directory exists
            await fs.mkdir(path.dirname(filename), { recursive: true });

            // Generate HTML
            const html = this.generateReportHTML(report);

            await fs.writeFile(filename, html, 'utf-8');
            console.log(`BrowserSubAgent: HTML report saved to ${filename}`);

            return filename;
        } catch (error: any) {
            console.error(`BrowserSubAgent: Failed to export HTML report: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generate HTML report content
     */
    private generateReportHTML(report: BrowserTestReport): string {
        const statusColor = report.overallStatus === 'passed' ? '#28a745' : report.overallStatus === 'failed' ? '#dc3545' : '#ffc107';
        const passedCount = report.steps.filter(s => s.status === 'passed').length;
        const failedCount = report.steps.filter(s => s.status === 'failed').length;
        const skippedCount = report.steps.filter(s => s.status === 'skipped').length;

        const stepsHTML = report.steps.map((step, i) => `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 12px; text-align: center;">${i + 1}</td>
                <td style="padding: 12px;">${step.step.description}</td>
                <td style="padding: 12px; text-align: center;">
                    <span style="padding: 4px 8px; border-radius: 4px; background-color: ${
                        step.status === 'passed' ? '#28a745' : step.status === 'failed' ? '#dc3545' : '#ffc107'
                    }; color: white; font-weight: bold;">${step.status.toUpperCase()}</span>
                </td>
                <td style="padding: 12px; text-align: center;">${step.duration}ms</td>
                <td style="padding: 12px;">${step.error ? `<code style="color: #dc3545;">${step.error}</code>` : '-'}</td>
            </tr>
        `).join('');

        const screenshotsHTML = report.screenshots.map(ss => `
            <div style="margin: 20px 0; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
                <h4 style="margin: 0 0 10px 0;">${ss.name}</h4>
                <img src="data:image/png;base64,${ss.base64}" style="max-width: 100%; border: 1px solid #ccc; border-radius: 4px;" alt="${ss.name}">
            </div>
        `).join('');

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Report - ${report.title}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #f5f5f5;
            padding: 20px;
            margin: 0;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            padding: 30px;
        }
        h1 {
            color: #333;
            margin: 0 0 20px 0;
            border-bottom: 3px solid ${statusColor};
            padding-bottom: 10px;
        }
        .header-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 30px;
        }
        .info-item {
            background-color: #f9f9f9;
            padding: 15px;
            border-left: 4px solid #007bff;
            border-radius: 4px;
        }
        .info-item label {
            font-weight: bold;
            color: #666;
            display: block;
            font-size: 12px;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        .info-item value {
            color: #333;
            font-size: 16px;
        }
        .status-badge {
            display: inline-block;
            padding: 8px 16px;
            border-radius: 4px;
            color: white;
            font-weight: bold;
            background-color: ${statusColor};
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
            margin-bottom: 30px;
        }
        .stat-card {
            background-color: #f9f9f9;
            padding: 20px;
            border-radius: 4px;
            text-align: center;
            border-top: 3px solid #007bff;
        }
        .stat-card.passed {
            border-top-color: #28a745;
        }
        .stat-card.failed {
            border-top-color: #dc3545;
        }
        .stat-card.skipped {
            border-top-color: #ffc107;
        }
        .stat-number {
            font-size: 32px;
            font-weight: bold;
            color: #333;
        }
        .stat-label {
            color: #666;
            font-size: 12px;
            text-transform: uppercase;
            margin-top: 5px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
        }
        th {
            background-color: #f9f9f9;
            padding: 12px;
            text-align: left;
            font-weight: bold;
            color: #333;
            border-bottom: 2px solid #ddd;
        }
        section {
            margin-bottom: 40px;
        }
        section h2 {
            color: #333;
            border-bottom: 2px solid #ddd;
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        code {
            background-color: #f5f5f5;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: "Courier New", monospace;
        }
        .error-list {
            list-style-position: inside;
            padding-left: 0;
        }
        .error-list li {
            padding: 8px;
            margin-bottom: 8px;
            background-color: #fff3cd;
            border-left: 4px solid #ffc107;
            border-radius: 4px;
        }
        .no-data {
            color: #999;
            font-style: italic;
            padding: 20px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>
            <span class="status-badge">${report.overallStatus.toUpperCase()}</span>
            ${report.title}
        </h1>

        <div class="header-info">
            <div class="info-item">
                <label>URL</label>
                <value>${report.url}</value>
            </div>
            <div class="info-item">
                <label>Duration</label>
                <value>${report.totalDuration}ms</value>
            </div>
            <div class="info-item">
                <label>Started</label>
                <value>${report.startedAt.toLocaleString()}</value>
            </div>
            <div class="info-item">
                <label>Agent ID</label>
                <value><code>${report.agentId}</code></value>
            </div>
        </div>

        <div class="stats">
            <div class="stat-card passed">
                <div class="stat-number">${passedCount}</div>
                <div class="stat-label">Passed</div>
            </div>
            <div class="stat-card failed">
                <div class="stat-number">${failedCount}</div>
                <div class="stat-label">Failed</div>
            </div>
            <div class="stat-card skipped">
                <div class="stat-number">${skippedCount}</div>
                <div class="stat-label">Skipped</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${report.steps.length}</div>
                <div class="stat-label">Total</div>
            </div>
        </div>

        <section>
            <h2>Test Steps</h2>
            <table>
                <thead>
                    <tr>
                        <th style="width: 50px;">Step</th>
                        <th>Description</th>
                        <th style="width: 120px;">Status</th>
                        <th style="width: 100px;">Duration</th>
                        <th>Error/Note</th>
                    </tr>
                </thead>
                <tbody>
                    ${stepsHTML}
                </tbody>
            </table>
        </section>

        ${report.screenshots.length > 0 ? `
        <section>
            <h2>Screenshots (${report.screenshots.length})</h2>
            ${screenshotsHTML}
        </section>
        ` : ''}

        ${report.consoleErrors.length > 0 ? `
        <section>
            <h2>Console Errors (${report.consoleErrors.length})</h2>
            <ul class="error-list">
                ${report.consoleErrors.map(err => `<li>${err}</li>`).join('')}
            </ul>
        </section>
        ` : ''}

        ${report.networkErrors.length > 0 ? `
        <section>
            <h2>Network Errors (${report.networkErrors.length})</h2>
            <ul class="error-list">
                ${report.networkErrors.map(err => `<li>${err}</li>`).join('')}
            </ul>
        </section>
        ` : ''}
    </div>
</body>
</html>
        `;
    }

    /**
     * Cleanup browser and resources
     */
    async cleanup(): Promise<void> {
        console.log('BrowserSubAgent: Cleaning up...');

        try {
            // Stop recording trace if in progress
            if (this.context) {
                try {
                    await this.context.tracing?.stop?.({ path: path.join(this.traceDir, `trace-${Date.now()}.zip`) });
                } catch (error) {
                    // Trace might not be recording
                }
            }

            // Close page
            if (this.page) {
                try {
                    await this.page.close();
                } catch (error) {
                    // Page might already be closed
                }
                this.page = null;
            }

            // Close context
            if (this.context) {
                try {
                    await this.context.close();
                } catch (error) {
                    // Context might already be closed
                }
                this.context = null;
            }

            // Close browser
            if (this.browser) {
                try {
                    await this.browser.close();
                } catch (error) {
                    // Browser might already be closed
                }
                this.browser = null;
            }

            this.isInitialized = false;
            console.log('BrowserSubAgent: Cleanup complete');

        } catch (error: any) {
            console.error(`BrowserSubAgent: Cleanup failed: ${error.message}`);
        }
    }

    /**
     * Force quit the browser (for emergencies)
     */
    async forceQuit(): Promise<void> {
        console.log('BrowserSubAgent: Force quitting...');

        try {
            // Kill playwright processes
            const pw = await loadPlaywright();
            if (pw.chromium) {
                await pw.chromium._browserServer?.kill?.();
            }
        } catch (error: any) {
            console.warn(`BrowserSubAgent: Force quit incomplete: ${error.message}`);
        }

        this.page = null;
        this.context = null;
        this.browser = null;
        this.isInitialized = false;
    }

    /**
     * Utility method for delays
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get browser version info
     */
    async getBrowserVersion(): Promise<string | null> {
        if (!this.browser) return null;
        return await this.browser.version();
    }
}
