/**
 * Tool Execution Orchestrator
 * Handles parallel and sequential tool execution with dependency management
 */

export interface ToolCall {
    id: string;
    name: string;
    args: any;
    waitForPreviousTools?: boolean;
}

export interface ToolResult {
    id: string;
    name: string;
    args: any;
    result: any;
    error?: string;
    startTime: number;
    endTime: number;
    duration: number;
}

export interface Tool {
    name: string;
    description: string;
    parameters: any;
    execute: (args: any, onOutput?: (output: string) => void) => Promise<any>;
}

export class ToolExecutionOrchestrator {
    private tools: Map<string, Tool> = new Map();
    private executionQueue: ToolCall[] = [];
    private results: Map<string, ToolResult> = new Map();
    private onToolStart?: (call: ToolCall) => void;
    private onToolEnd?: (result: ToolResult) => void;
    private onToolError?: (call: ToolCall, error: string) => void;
    private onToolOutput?: (id: string, output: string) => void;

    /**
     * Register a tool
     */
    registerTool(tool: Tool) {
        this.tools.set(tool.name, tool);
    }

    /**
     * Set event callbacks
     */
    setCallbacks(callbacks: {
        onToolStart?: (call: ToolCall) => void;
        onToolEnd?: (result: ToolResult) => void;
        onToolError?: (call: ToolCall, error: string) => void;
        onToolOutput?: (id: string, output: string) => void;
    }) {
        this.onToolStart = callbacks.onToolStart;
        this.onToolEnd = callbacks.onToolEnd;
        this.onToolError = callbacks.onToolError;
        this.onToolOutput = callbacks.onToolOutput;
    }

    /**
     * Execute a batch of tool calls with dependency management
     * @param toolCalls Array of tool calls to execute
     * @returns Array of tool results
     */
    async executeBatch(toolCalls: ToolCall[], abortSignal?: AbortSignal): Promise<ToolResult[]> {
        if (toolCalls.length === 0) return [];

        // Group tool calls into batches based on waitForPreviousTools
        const batches = this.groupIntoBatches(toolCalls);
        const allResults: ToolResult[] = [];

        // Execute each batch sequentially, but tools within a batch in parallel
        for (const batch of batches) {
            if (abortSignal?.aborted) break;
            const batchResults = await this.executeParallel(batch, abortSignal);
            allResults.push(...batchResults);
        }

        return allResults;
    }

    /**
     * Group tool calls into batches based on dependencies
     */
    private groupIntoBatches(toolCalls: ToolCall[]): ToolCall[][] {
        const batches: ToolCall[][] = [];
        let currentBatch: ToolCall[] = [];

        for (const call of toolCalls) {
            if (call.waitForPreviousTools && currentBatch.length > 0) {
                // Start a new batch
                batches.push(currentBatch);
                currentBatch = [call];
            } else {
                currentBatch.push(call);
            }
        }

        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }

        return batches;
    }

    /**
     * Execute multiple tool calls in parallel
     */
    private async executeParallel(toolCalls: ToolCall[], abortSignal?: AbortSignal): Promise<ToolResult[]> {
        const promises = toolCalls.map(call => this.executeSingle(call, abortSignal));
        return Promise.all(promises);
    }

    /**
     * Execute a single tool call
     */
    private async executeSingle(call: ToolCall, abortSignal?: AbortSignal): Promise<ToolResult> {
        const startTime = Date.now();

        // Notify start
        if (this.onToolStart) {
            this.onToolStart(call);
        }

        const tool = this.tools.get(call.name);
        if (!tool) {
            const error = `Tool '${call.name}' not found`;
            const result: ToolResult = {
                id: call.id,
                name: call.name,
                args: call.args,
                result: null,
                error,
                startTime,
                endTime: Date.now(),
                duration: Date.now() - startTime
            };

            if (this.onToolError) {
                this.onToolError(call, error);
            }

            this.results.set(call.id, result);
            return result;
        }

        try {
            // Use timeout from args if available (or default to 10 minutes) + small buffer
            const requestedTimeout = (call.args && typeof call.args.timeout === 'number') ? call.args.timeout : 600000;
            const TIMEOUT_MS = requestedTimeout + 5000;

            const executionPromise = tool.execute(call.args, (output) => {
                if (this.onToolOutput) {
                    this.onToolOutput(call.id, output);
                }
            });
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Tool execution timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
            });
            const abortPromise = new Promise((_, reject) => {
                if (abortSignal) {
                    if (abortSignal.aborted) reject(new Error('Tool execution aborted'));
                    abortSignal.addEventListener('abort', () => reject(new Error('Tool execution aborted')));
                }
            });

            const executionResult = await Promise.race([executionPromise, timeoutPromise, abortPromise]);
            const endTime = Date.now();

            const result: ToolResult = {
                id: call.id,
                name: call.name,
                args: call.args,
                result: executionResult,
                startTime,
                endTime,
                duration: endTime - startTime
            };

            // Notify end
            if (this.onToolEnd) {
                this.onToolEnd(result);
            }

            this.results.set(call.id, result);
            return result;
        } catch (error: any) {
            const endTime = Date.now();
            const errorMessage = error.message || String(error);

            const result: ToolResult = {
                id: call.id,
                name: call.name,
                args: call.args,
                result: null,
                error: errorMessage,
                startTime,
                endTime,
                duration: endTime - startTime
            };

            // Notify error
            if (this.onToolError) {
                this.onToolError(call, errorMessage);
            }

            this.results.set(call.id, result);
            return result;
        }
    }

    /**
     * Get result by ID
     */
    getResult(id: string): ToolResult | undefined {
        return this.results.get(id);
    }

    /**
     * Get all results
     */
    getAllResults(): ToolResult[] {
        return Array.from(this.results.values());
    }

    /**
     * Clear results
     */
    clearResults() {
        this.results.clear();
    }

    /**
     * Get execution statistics
     */
    getStatistics(): {
        totalCalls: number;
        successfulCalls: number;
        failedCalls: number;
        averageDuration: number;
        totalDuration: number;
    } {
        const results = this.getAllResults();
        const successful = results.filter(r => !r.error);
        const failed = results.filter(r => r.error);
        const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
        const averageDuration = results.length > 0 ? totalDuration / results.length : 0;

        return {
            totalCalls: results.length,
            successfulCalls: successful.length,
            failedCalls: failed.length,
            averageDuration: Math.round(averageDuration),
            totalDuration
        };
    }

    /**
     * Analyze tool call dependencies
     * Returns a visualization of parallel vs sequential execution
     */
    analyzeDependencies(toolCalls: ToolCall[]): string {
        const batches = this.groupIntoBatches(toolCalls);
        let analysis = 'Tool Execution Plan:\n\n';

        batches.forEach((batch, index) => {
            analysis += `Batch ${index + 1} (${batch.length} tool${batch.length > 1 ? 's' : ''} in parallel):\n`;
            batch.forEach(call => {
                analysis += `  - ${call.name}\n`;
            });
            analysis += '\n';
        });

        analysis += `Total batches: ${batches.length}\n`;
        analysis += `Total tools: ${toolCalls.length}\n`;

        const parallelizable = toolCalls.filter(c => !c.waitForPreviousTools).length;
        analysis += `Parallelizable: ${parallelizable}\n`;
        analysis += `Sequential: ${toolCalls.length - parallelizable}\n`;

        return analysis;
    }
}
