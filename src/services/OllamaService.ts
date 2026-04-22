/**
 * OllamaService.ts
 * Dedicated client for the Ollama local model API.
 *
 * Supports:
 *  - Model discovery (list running/available models)
 *  - Health / connectivity checks
 *  - Streaming chat completions (Ollama /api/chat)
 *  - Tool-call emulation via JSON-mode for models that don't support native function calling
 *  - Graceful fallback when Ollama is not running
 */

export interface OllamaModel {
    name: string;
    displayName: string;
    size: string;
    family: string;
    supportsTools: boolean;
    modified_at: string;
}

export interface OllamaChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: OllamaToolCall[];
    tool_call_id?: string;
    name?: string;
}

export interface OllamaToolCall {
    id: string;
    name: string;
    args: Record<string, any>;
}

export interface OllamaCompletionResult {
    text: string;
    toolCalls: OllamaToolCall[];
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

// Models known to support native tool calling via Ollama
const TOOL_CAPABLE_MODELS = new Set([
    'llama3.1', 'llama3.2', 'llama3.3', 'llama3-groq-tool-use',
    'mistral-nemo', 'mistral-small', 'qwen2', 'qwen2.5',
    'command-r', 'command-r-plus', 'hermes3', 'firefunction-v2',
    'nemotron-mini', 'aya-expanse', 'smollm2',
]);

function modelSupportsTools(modelName: string): boolean {
    const base = modelName.toLowerCase().split(':')[0];
    return Array.from(TOOL_CAPABLE_MODELS).some(t => base.startsWith(t));
}

// Tool-call extraction prompt appended when model doesn't support native tools
const TOOL_CALL_INSTRUCTION = `
You have access to the following tools. When you want to use a tool, respond ONLY with a JSON block in this exact format (do not include any other text before or after):

\`\`\`json
{
  "tool_calls": [
    {
      "name": "<tool_name>",
      "arguments": { ... }
    }
  ]
}
\`\`\`

If you do NOT need to call a tool, respond normally as text.
`;

export class OllamaService {
    private baseUrl: string;
    private requestTimeout: number;

    constructor(baseUrl: string = 'http://localhost:11434', requestTimeout: number = 300000) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.requestTimeout = requestTimeout;
    }

    // ──────────────────────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────────────────────

    public updateBaseUrl(baseUrl: string): void {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    public updateTimeout(timeoutMs: number): void {
        this.requestTimeout = timeoutMs;
    }

    /**
     * Check whether Ollama is reachable and return the version string.
     */
    public async healthCheck(): Promise<{ healthy: boolean; version?: string; error?: string }> {
        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(`${this.baseUrl}/api/version`, { signal: controller.signal }).catch(err => {
                throw new Error(`Connection refused: ${err.message}`);
            });
            clearTimeout(tid);
            if (!res.ok) {
                return { healthy: false, error: `HTTP ${res.status}` };
            }
            const body: any = await res.json();
            return { healthy: true, version: body.version };
        } catch (e: any) {
            const msg = e.name === 'AbortError'
                ? `Connection timed out (5s). Is Ollama running at ${this.baseUrl}?`
                : `Cannot reach Ollama at ${this.baseUrl}. Ensure Ollama is running (ollama serve).`;
            return { healthy: false, error: msg };
        }
    }

    /**
     * List all locally available models.
     */
    public async listModels(): Promise<OllamaModel[]> {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body: any = await res.json();
            return (body.models || []).map((m: any) => this.parseModelInfo(m));
        } catch (e: any) {
            console.error('OllamaService: Failed to list models:', e.message);
            return [];
        }
    }

    /**
     * List models currently loaded in memory (running).
     */
    public async listRunningModels(): Promise<OllamaModel[]> {
        try {
            const res = await fetch(`${this.baseUrl}/api/ps`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body: any = await res.json();
            return (body.models || []).map((m: any) => this.parseModelInfo(m));
        } catch (e: any) {
            console.error('OllamaService: Failed to list running models:', e.message);
            return [];
        }
    }

    /**
     * Chat completion with streaming support.
     * Automatically selects between native tool calling and JSON-mode emulation.
     */
    public async chatCompletion(
        model: string,
        messages: OllamaChatMessage[],
        tools: any[],
        onChunk: (chunk: string) => void,
        options: { temperature?: number; maxTokens?: number } = {},
        abortSignal?: AbortSignal
    ): Promise<OllamaCompletionResult> {
        const supportsTools = modelSupportsTools(model);

        if (supportsTools && tools.length > 0) {
            return this.nativeToolCompletion(model, messages, tools, onChunk, options, abortSignal);
        } else if (!supportsTools && tools.length > 0) {
            return this.emulatedToolCompletion(model, messages, tools, onChunk, options, abortSignal);
        } else {
            return this.plainCompletion(model, messages, onChunk, options, abortSignal);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────

    private parseModelInfo(m: any): OllamaModel {
        const name: string = m.name || m.model || '';
        const base = name.split(':')[0].toLowerCase();
        const details = m.details || {};
        const sizeBytes: number = m.size || 0;
        const sizeMb = sizeBytes > 0 ? `${(sizeBytes / 1_073_741_824).toFixed(1)} GB` : 'unknown';

        return {
            name,
            displayName: name,
            size: sizeMb,
            family: details.family || base,
            supportsTools: modelSupportsTools(name),
            modified_at: m.modified_at || '',
        };
    }

    /** Native Ollama tool calling (for supported models like llama3.1+) */
    private async nativeToolCompletion(
        model: string,
        messages: OllamaChatMessage[],
        tools: any[],
        onChunk: (chunk: string) => void,
        options: Record<string, any>,
        abortSignal?: AbortSignal
    ): Promise<OllamaCompletionResult> {
        const ollamaTools = tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters }
        }));

        const body = {
            model,
            messages: this.convertMessages(messages),
            tools: ollamaTools,
            stream: true,
            options: {
                temperature: options.temperature ?? 0.7,
                num_predict: options.maxTokens ?? 8192,
            },
        };

        return this.streamRequest('/api/chat', body, onChunk, abortSignal, true);
    }

    /** JSON-mode tool emulation for models without native function calling */
    private async emulatedToolCompletion(
        model: string,
        messages: OllamaChatMessage[],
        tools: any[],
        onChunk: (chunk: string) => void,
        options: Record<string, any>,
        abortSignal?: AbortSignal
    ): Promise<OllamaCompletionResult> {
        // Build a system message that explains the available tools
        const toolSchemas = tools.map(t =>
            `Tool: ${t.name}\nDescription: ${t.description}\nParameters: ${JSON.stringify(t.parameters, null, 2)}`
        ).join('\n\n---\n\n');

        const systemInstructions = `${TOOL_CALL_INSTRUCTION}\n\nAvailable tools:\n\n${toolSchemas}`;

        // Prepend or merge system instructions
        const augmented: OllamaChatMessage[] = [
            { role: 'system', content: systemInstructions },
            ...messages.filter(m => m.role !== 'system'),
        ];

        const body = {
            model,
            messages: this.convertMessages(augmented),
            stream: true,
            options: {
                temperature: options.temperature ?? 0.7,
                num_predict: options.maxTokens ?? 8192,
            },
        };

        const result = await this.streamRequest('/api/chat', body, onChunk, abortSignal, false);

        // Attempt to extract tool calls from the text output
        const extracted = this.extractToolCallsFromText(result.text);
        if (extracted.length > 0) {
            return { text: '', toolCalls: extracted, usage: result.usage };
        }
        return result;
    }

    /** Plain chat completion without any tool handling */
    private async plainCompletion(
        model: string,
        messages: OllamaChatMessage[],
        onChunk: (chunk: string) => void,
        options: Record<string, any>,
        abortSignal?: AbortSignal
    ): Promise<OllamaCompletionResult> {
        const body = {
            model,
            messages: this.convertMessages(messages),
            stream: true,
            options: {
                temperature: options.temperature ?? 0.7,
                num_predict: options.maxTokens ?? 8192,
            },
        };
        return this.streamRequest('/api/chat', body, onChunk, abortSignal, false);
    }

    /** Core streaming fetch → reads NDJSON lines from Ollama */
    private async streamRequest(
        path: string,
        body: Record<string, any>,
        onChunk: (chunk: string) => void,
        abortSignal: AbortSignal | undefined,
        parseNativeTools: boolean
    ): Promise<OllamaCompletionResult> {
        const url = `${this.baseUrl}${path}`;

        const timeoutController = new AbortController();
        const tid = setTimeout(() => timeoutController.abort(), this.requestTimeout);

        // Merge abort signals
        const combinedSignal = abortSignal
            ? this.mergeAbortSignals(abortSignal, timeoutController.signal)
            : timeoutController.signal;

        let fullText = '';
        const toolCalls: OllamaToolCall[] = [];
        let promptTokens = 0;
        let completionTokens = 0;

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: combinedSignal,
            });

            if (!res.ok) {
                const errBody = await res.text();
                throw new Error(`Ollama API error ${res.status}: ${errBody}`);
            }

            if (!res.body) throw new Error('Response body is null');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Ollama streams newline-delimited JSON
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    try {
                        const chunk: any = JSON.parse(trimmed);

                        if (chunk.error) {
                            throw new Error(`Ollama error: ${chunk.error}`);
                        }

                        const delta = chunk.message;
                        if (delta) {
                            // Text content
                            if (delta.content) {
                                fullText += delta.content;
                                onChunk(delta.content);
                            }

                            // Native tool calls (llama3.1+)
                            if (parseNativeTools && delta.tool_calls) {
                                for (const tc of delta.tool_calls) {
                                    toolCalls.push({
                                        id: `ollama_${Date.now()}_${toolCalls.length}`,
                                        name: tc.function?.name || '',
                                        args: typeof tc.function?.arguments === 'string'
                                            ? this.safeJsonParse(tc.function.arguments)
                                            : (tc.function?.arguments || {}),
                                    });
                                }
                            }
                        }

                        // Usage stats (last chunk)
                        if (chunk.done && chunk.prompt_eval_count !== undefined) {
                            promptTokens = chunk.prompt_eval_count || 0;
                            completionTokens = chunk.eval_count || 0;
                        }
                    } catch (parseErr: any) {
                        if (parseErr.message?.startsWith('Ollama error')) throw parseErr;
                        // Ignore JSON parse errors for partial chunks
                    }
                }
            }
        } catch (e: any) {
            if (e.name === 'AbortError') throw e;
            if (e.message?.includes('fetch failed') || e.message?.includes('refused')) {
                throw new Error(`Ollama connection failed at ${this.baseUrl}. Ensure Ollama is running (ollama serve).`);
            }
            throw e;
        } finally {
            clearTimeout(tid);
        }

        return {
            text: fullText,
            toolCalls,
            usage: {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
            },
        };
    }

    /** Convert from the internal history format to Ollama message format */
    private convertMessages(messages: OllamaChatMessage[]): any[] {
        return messages.map(m => {
            const base: any = { role: m.role, content: m.content };
            if (m.tool_calls && m.tool_calls.length > 0) {
                base.tool_calls = m.tool_calls.map(tc => ({
                    type: 'function',
                    function: { name: tc.name, arguments: tc.args },
                }));
            }
            return base;
        });
    }

    /**
     * Extract tool calls that the model embedded as JSON in the text response.
     * Handles ```json ... ``` blocks as well as raw JSON.
     */
    private extractToolCallsFromText(text: string): OllamaToolCall[] {
        const jsonBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
        let match: RegExpExecArray | null;

        while ((match = jsonBlockRegex.exec(text)) !== null) {
            try {
                const parsed = JSON.parse(match[1]);
                if (parsed?.tool_calls && Array.isArray(parsed.tool_calls)) {
                    return parsed.tool_calls.map((tc: any, i: number) => ({
                        id: `emulated_${Date.now()}_${i}`,
                        name: tc.name || tc.function || '',
                        args: tc.arguments || tc.args || {},
                    }));
                }
            } catch { /* not valid JSON */ }
        }

        // Fallback: check if entire text is JSON
        try {
            const raw = text.trim();
            if (raw.startsWith('{') || raw.startsWith('[')) {
                const parsed = JSON.parse(raw);
                if (parsed?.tool_calls) {
                    return parsed.tool_calls.map((tc: any, i: number) => ({
                        id: `emulated_${Date.now()}_${i}`,
                        name: tc.name || '',
                        args: tc.arguments || {},
                    }));
                }
            }
        } catch { /* not JSON */ }

        return [];
    }

    private safeJsonParse(text: string): Record<string, any> {
        try { return JSON.parse(text); } catch { return {}; }
    }

    /**
     * Merge two AbortSignals — aborts when either fires.
     */
    private mergeAbortSignals(s1: AbortSignal, s2: AbortSignal): AbortSignal {
        const controller = new AbortController();
        const abort = () => controller.abort();
        s1.addEventListener('abort', abort, { once: true });
        s2.addEventListener('abort', abort, { once: true });
        if (s1.aborted || s2.aborted) controller.abort();
        return controller.signal;
    }
}
