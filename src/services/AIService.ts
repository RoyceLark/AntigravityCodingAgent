import * as vscode from 'vscode';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { TokenBudgetManager, TokenUsage } from './TokenBudgetManager';
import { OllamaService } from './OllamaService';
import { ModelRegistry, ProviderType } from './ModelRegistry';

export type { ProviderType };

export class AIService {
    private provider: ProviderType = 'openai';
    private apiKey: string = '';
    private baseUrl: string = '';
    private model: string = '';
    private temperature: number = 0.7;
    private maxTokens: number = 8192;

    private genAI: GoogleGenerativeAI | null = null;
    private openai: OpenAI | null = null;
    private anthropic: Anthropic | null = null;
    private ollamaService: OllamaService;

    private budgetManager: TokenBudgetManager;
    public modelRegistry: ModelRegistry;

    constructor(private context: vscode.ExtensionContext) {
        this.budgetManager = new TokenBudgetManager();
        this.ollamaService = new OllamaService();
        this.modelRegistry = new ModelRegistry(context);
        this.loadSettings();

        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('cnx')) {
                this.loadSettings();
            }
        });
    }

    // ──────────────────────────────────────
    // Settings
    // ──────────────────────────────────────

    private async loadSettings() {
        const config = vscode.workspace.getConfiguration('cnx');
        this.provider = (config.get<string>('aiProvider') || 'openai') as ProviderType;
        this.temperature = config.get<number>('temperature') ?? 0.7;
        this.maxTokens = config.get<number>('maxTokens') ?? 8192;

        const envKey = process.env.LLM_API_KEY;
        const envUrl = process.env.LLM_API_URL;
        const envModel = process.env.LLM_MODEL;

        this.model = envModel || config.get<string>('model') || 'gpt-4o';

        // Determine API key by provider
        if (this.provider === 'ollama') {
            this.apiKey = '';
            const ollamaUrl = config.get<string>('ollamaBaseUrl') || 'http://localhost:11434';
            this.ollamaService.updateBaseUrl(ollamaUrl);
            this.baseUrl = ollamaUrl;
        } else if (this.provider === 'gemini') {
            this.apiKey = envKey || config.get<string>('geminiApiKey') || '';
            this.baseUrl = '';
        } else if (this.provider === 'anthropic') {
            this.apiKey = envKey || config.get<string>('anthropicApiKey') || '';
            this.baseUrl = '';
        } else {
            // openai or openai-compatible
            this.apiKey = envKey || config.get<string>('openaiApiKey') || '';
            this.baseUrl = envUrl || config.get<string>('openaiBaseUrl') || 'https://api.openai.com/v1';
        }

        // Initialise provider clients
        this.genAI = null;
        this.openai = null;
        this.anthropic = null;

        if (this.provider === 'gemini' && this.apiKey) {
            this.genAI = new GoogleGenerativeAI(this.apiKey);
        } else if ((this.provider === 'openai' || this.provider === 'openai-compatible') && this.apiKey) {
            this.openai = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseUrl });
        } else if (this.provider === 'anthropic' && this.apiKey) {
            this.anthropic = new Anthropic({ apiKey: this.apiKey });
        }

        console.log(`AIService: provider="${this.provider}", model="${this.model}", baseUrl="${this.baseUrl}"`);
    }

    // ──────────────────────────────────────
    // Public API
    // ──────────────────────────────────────

    public isConfigured(): boolean {
        if (this.provider === 'ollama') return true; // Ollama needs no API key
        return !!this.apiKey;
    }

    public getCurrentProvider(): ProviderType {
        return this.provider;
    }

    public getCurrentModel(): string {
        return this.model;
    }

    public getModelRegistry(): ModelRegistry {
        return this.modelRegistry;
    }

    public async getCompletionWithTools(
        prompt: string,
        history: any[],
        tools: any[],
        onTextChunk?: (chunk: string) => void,
        modelOverride?: string,
        currentContext?: string,
        abortSignal?: AbortSignal
    ): Promise<{ text: string; toolCalls: any[]; usage?: TokenUsage }> {
        const modelToUse = modelOverride || this.model;

        switch (this.provider) {
            case 'ollama':
                return this.ollamaCompletion(prompt, history, tools, onTextChunk, modelToUse, currentContext, abortSignal);
            case 'gemini':
                return this.geminiCompletion(prompt, history, tools, onTextChunk, modelToUse, currentContext, abortSignal);
            case 'anthropic':
                return this.anthropicCompletion(prompt, history, tools, onTextChunk, modelToUse, currentContext, abortSignal);
            default:
                return this.openAICompletion(prompt, history, tools, onTextChunk, modelToUse, currentContext, abortSignal);
        }
    }

    public async streamResponse(
        prompt: string,
        history: any[],
        onChunk: (chunk: string) => void,
        abortSignal?: AbortSignal
    ): Promise<void> {
        await this.getCompletionWithTools(prompt, history, [], onChunk, undefined, undefined, abortSignal);
    }

    // ──────────────────────────────────────
    // Ollama
    // ──────────────────────────────────────

    private async ollamaCompletion(
        prompt: string,
        history: any[],
        tools: any[],
        onTextChunk: ((chunk: string) => void) | undefined,
        model: string,
        currentContext: string | undefined,
        abortSignal: AbortSignal | undefined
    ): Promise<{ text: string; toolCalls: any[]; usage?: TokenUsage }> {
        const messages = this.buildOllamaMessages(prompt, history, currentContext);

        const result = await this.ollamaService.chatCompletion(
            model,
            messages,
            tools,
            onTextChunk || (() => {}),
            { temperature: this.temperature, maxTokens: this.maxTokens },
            abortSignal
        );

        return {
            text: result.text,
            toolCalls: result.toolCalls.map(tc => ({ id: tc.id, name: tc.name, args: tc.args })),
            usage: result.usage ? {
                promptTokens: result.usage.promptTokens,
                completionTokens: result.usage.completionTokens,
                totalTokens: result.usage.totalTokens,
                cachedTokens: 0,
            } : undefined,
        };
    }

    private buildOllamaMessages(prompt: string, history: any[], currentContext?: string): any[] {
        const messages: any[] = [];

        messages.push({ role: 'system', content: this.getSystemPrompt() });
        if (currentContext) {
            messages.push({ role: 'system', content: `### CURRENT IDE STATE\n${currentContext}` });
        }

        for (const turn of history) {
            if (turn.role === 'user') {
                messages.push({ role: 'user', content: turn.parts[0]?.text || '' });
            } else if (turn.role === 'model') {
                const text = turn.parts.find((p: any) => 'text' in p)?.text || '';
                const toolCalls = turn.parts.filter((p: any) => p.functionCall).map((p: any) => ({
                    id: p.functionCall.callId || `call_${Math.random().toString(36).slice(2)}`,
                    name: p.functionCall.name,
                    args: p.functionCall.args,
                }));
                const msg: any = { role: 'assistant', content: text };
                if (toolCalls.length > 0) msg.tool_calls = toolCalls;
                messages.push(msg);
            } else if (turn.role === 'function') {
                const fp = turn.parts[0]?.functionResponse;
                messages.push({
                    role: 'tool',
                    tool_call_id: fp?.callId || 'default',
                    content: typeof fp?.response === 'string' ? fp.response : JSON.stringify(fp?.response),
                    name: fp?.name,
                });
            }
        }

        if (prompt) messages.push({ role: 'user', content: prompt });
        return messages;
    }

    // ──────────────────────────────────────
    // OpenAI / OpenAI-Compatible
    // ──────────────────────────────────────

    private async openAICompletion(
        prompt: string,
        history: any[],
        tools: any[],
        onTextChunk: ((chunk: string) => void) | undefined,
        model: string,
        currentContext: string | undefined,
        abortSignal: AbortSignal | undefined
    ): Promise<{ text: string; toolCalls: any[]; usage?: TokenUsage }> {
        if (!this.openai) {
            throw new Error('OpenAI client not configured. Please set your API key in settings.');
        }

        const systemPromptEst = 1000 + (currentContext ? currentContext.length / 4 : 0);
        const prunedHistory = this.budgetManager.pruneContext(history, 100000 - systemPromptEst);
        const messages = this.buildOpenAIMessages(prompt, prunedHistory, currentContext);

        const toolDefs = tools.length > 0 ? tools.map(t => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters }
        })) : undefined;

        if (onTextChunk) {
            return this.openAIStream(model, messages, toolDefs, onTextChunk, abortSignal);
        } else {
            return this.openAINonStream(model, messages, toolDefs, abortSignal);
        }
    }

    private async openAIStream(
        model: string,
        messages: any[],
        tools: any[] | undefined,
        onChunk: (chunk: string) => void,
        abortSignal: AbortSignal | undefined
    ): Promise<{ text: string; toolCalls: any[]; usage?: TokenUsage }> {
        const opts: any = { model, messages, stream: true, max_tokens: this.maxTokens };
        if (tools) opts.tools = tools;

        let fullText = '';
        let toolCalls: any[] = [];
        let usage: any = null;

        try {
            const stream: any = await this.openai!.chat.completions.create(opts, { signal: abortSignal });

            if (typeof (stream as any)[Symbol.asyncIterator] !== 'function') {
                throw new Error('API returned a non-streaming response (JSON instead of stream). Check your proxy/gateway config.');
            }

            for await (const chunk of stream) {
                if (!chunk?.choices?.length) continue;
                const delta = chunk.choices[0]?.delta;
                if (delta?.content) { fullText += delta.content; onChunk(delta.content); }
                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        if (!toolCalls[tc.index]) {
                            toolCalls[tc.index] = { id: tc.id, name: tc.function?.name || '', args: '' };
                        }
                        if (tc.function?.arguments) toolCalls[tc.index].args += tc.function.arguments;
                    }
                }
                if (chunk.usage) {
                    usage = {
                        promptTokens: chunk.usage.prompt_tokens || 0,
                        completionTokens: chunk.usage.completion_tokens || 0,
                        totalTokens: chunk.usage.total_tokens || 0,
                        cachedTokens: (chunk.usage as any).prompt_tokens_details?.cached_tokens || 0,
                    };
                }
            }
        } catch (error: any) {
            if (error.name === 'AbortError') throw error;
            throw new Error(this.formatOpenAIError(error));
        }

        return {
            text: fullText,
            toolCalls: toolCalls.filter(Boolean).map(tc => ({
                id: tc.id, name: tc.name, args: this.safeJSONParse(tc.args || '{}')
            })),
            usage,
        };
    }

    private async openAINonStream(
        model: string,
        messages: any[],
        tools: any[] | undefined,
        abortSignal: AbortSignal | undefined
    ): Promise<{ text: string; toolCalls: any[]; usage?: TokenUsage }> {
        const opts: any = { model, messages, max_tokens: this.maxTokens };
        if (tools) opts.tools = tools;

        const response = await this.openai!.chat.completions.create(opts, { signal: abortSignal });
        const message = response.choices[0].message;
        const toolCalls = message.tool_calls?.map((tc: any) => ({
            id: tc.id, name: tc.function.name, args: this.safeJSONParse(tc.function.arguments)
        })) || [];

        return {
            text: message.content || '',
            toolCalls,
            usage: response.usage ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
                cachedTokens: (response.usage as any).prompt_tokens_details?.cached_tokens || 0,
            } : undefined,
        };
    }

    public buildOpenAIMessages(prompt: string, history: any[], currentContext?: string): any[] {
        const messages: any[] = [];
        messages.push({ role: 'system', content: this.getSystemPrompt() });
        if (currentContext) {
            messages.push({ role: 'system', content: `### CURRENT IDE STATE (Fresh Context)\n${currentContext}` });
        }

        const toolCallIdMap = new Map<string, string>();

        for (const turn of history) {
            if (turn.role === 'user') {
                messages.push({ role: 'user', content: turn.parts[0]?.text || '' });
            } else if (turn.role === 'model') {
                const toolCalls = turn.parts
                    .filter((p: any) => p.functionCall)
                    .map((p: any) => {
                        const callId = p.callId || p.functionCall.callId || `call_${Math.random().toString(36).slice(2, 9)}`;
                        toolCallIdMap.set(p.functionCall.name, callId);
                        return {
                            id: callId,
                            type: 'function' as const,
                            function: {
                                name: p.functionCall.name,
                                arguments: typeof p.functionCall.args === 'string'
                                    ? p.functionCall.args
                                    : JSON.stringify(p.functionCall.args)
                            }
                        };
                    });

                const textPart = turn.parts.find((p: any) => 'text' in p);
                const contentText = textPart?.text || '';

                if (toolCalls.length > 0) {
                    messages.push({ role: 'assistant', content: contentText || null, tool_calls: toolCalls });
                } else {
                    messages.push({ role: 'assistant', content: contentText });
                }
            } else if (turn.role === 'function') {
                const funcPart = turn.parts[0]?.functionResponse;
                const toolCallId = funcPart?.callId || toolCallIdMap.get(funcPart?.name) || 'default_id';
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCallId,
                    content: typeof funcPart?.response === 'string' ? funcPart.response : JSON.stringify(funcPart?.response)
                });
            }
        }

        if (prompt) messages.push({ role: 'user', content: prompt });
        return messages;
    }

    // ──────────────────────────────────────
    // Gemini
    // ──────────────────────────────────────

    private async geminiCompletion(
        prompt: string,
        history: any[],
        tools: any[],
        onTextChunk: ((chunk: string) => void) | undefined,
        model: string,
        currentContext: string | undefined,
        abortSignal: AbortSignal | undefined
    ): Promise<{ text: string; toolCalls: any[]; usage?: TokenUsage }> {
        if (!this.genAI) {
            throw new Error('Gemini client not configured. Please set your API key in settings.');
        }

        const geminiModel = this.genAI.getGenerativeModel({ model });
        const chat = geminiModel.startChat({ history });

        const fullPrompt = currentContext
            ? `### CURRENT IDE STATE\n${currentContext}\n\n${prompt}`
            : prompt;

        if (onTextChunk) {
            const result = await chat.sendMessageStream(fullPrompt);
            let fullText = '';
            for await (const chunk of result.stream) {
                const text = chunk.text();
                fullText += text;
                onTextChunk(text);
            }
            return { text: fullText, toolCalls: [] };
        } else {
            const result = await chat.sendMessage(fullPrompt);
            return { text: result.response.text(), toolCalls: [] };
        }
    }

    // ──────────────────────────────────────
    // Anthropic
    // ──────────────────────────────────────

    private async anthropicCompletion(
        prompt: string,
        history: any[],
        tools: any[],
        onTextChunk: ((chunk: string) => void) | undefined,
        model: string,
        currentContext: string | undefined,
        abortSignal: AbortSignal | undefined
    ): Promise<{ text: string; toolCalls: any[]; usage?: TokenUsage }> {
        if (!this.anthropic) {
            throw new Error('Anthropic client not configured. Please set your API key in settings.');
        }

        const systemContent = currentContext
            ? `${this.getSystemPrompt()}\n\n### CURRENT IDE STATE\n${currentContext}`
            : this.getSystemPrompt();

        const messages = this.buildAnthropicMessages(prompt, history);
        const anthropicTools = tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
        }));

        const opts: any = {
            model,
            max_tokens: this.maxTokens,
            system: systemContent,
            messages,
        };
        if (anthropicTools.length > 0) opts.tools = anthropicTools;

        if (onTextChunk) {
            let fullText = '';
            const toolCalls: any[] = [];

            const stream = await this.anthropic.messages.stream(opts);
            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                    fullText += event.delta.text;
                    onTextChunk(event.delta.text);
                } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
                    toolCalls.push({ id: event.content_block.id, name: event.content_block.name, args: {} });
                } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
                    // accumulate
                }
            }

            const finalMsg = await stream.finalMessage();
            const finalToolCalls = finalMsg.content
                .filter((b: any) => b.type === 'tool_use')
                .map((b: any) => ({ id: b.id, name: b.name, args: b.input }));

            return {
                text: fullText,
                toolCalls: finalToolCalls,
                usage: finalMsg.usage ? {
                    promptTokens: finalMsg.usage.input_tokens,
                    completionTokens: finalMsg.usage.output_tokens,
                    totalTokens: finalMsg.usage.input_tokens + finalMsg.usage.output_tokens,
                    cachedTokens: (finalMsg.usage as any).cache_read_input_tokens || 0,
                } : undefined,
            };
        } else {
            const response = await this.anthropic.messages.create(opts);
            const textBlocks = response.content.filter((b: any) => b.type === 'text');
            const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use');
            return {
                text: textBlocks.map((b: any) => b.text).join(''),
                toolCalls: toolUseBlocks.map((b: any) => ({ id: b.id, name: b.name, args: b.input })),
                usage: response.usage ? {
                    promptTokens: response.usage.input_tokens,
                    completionTokens: response.usage.output_tokens,
                    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
                    cachedTokens: 0,
                } : undefined,
            };
        }
    }

    private buildAnthropicMessages(prompt: string, history: any[]): any[] {
        const messages: any[] = [];
        for (const turn of history) {
            if (turn.role === 'user') {
                messages.push({ role: 'user', content: turn.parts[0]?.text || '' });
            } else if (turn.role === 'model') {
                const content: any[] = [];
                const textPart = turn.parts.find((p: any) => 'text' in p);
                if (textPart?.text) content.push({ type: 'text', text: textPart.text });
                turn.parts.filter((p: any) => p.functionCall).forEach((p: any) => {
                    content.push({ type: 'tool_use', id: p.functionCall.callId || 'call_id', name: p.functionCall.name, input: p.functionCall.args });
                });
                if (content.length > 0) messages.push({ role: 'assistant', content });
            } else if (turn.role === 'function') {
                const fp = turn.parts[0]?.functionResponse;
                messages.push({
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: fp?.callId || 'call_id', content: JSON.stringify(fp?.response) }]
                });
            }
        }
        if (prompt) messages.push({ role: 'user', content: prompt });
        return messages;
    }

    // ──────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────

    private getSystemPrompt(): string {
        return `### IDENTITY & CORE DIRECTIVE
You are Cnx Agent, an elite autonomous AI software engineer with deep VS Code integration.
You operate with FULL AUTONOMY - execute tasks immediately without asking permission.

**Prime Directive:** Complete tasks flawlessly through direct action, not suggestion.

### AUTONOMOUS CAPABILITIES
- Read/Write: view_file, write_to_file, replace_file_content, multi_replace_file_content
- Navigate: list_dir, find_by_name, grep_search, view_code_item
- Execute: run_command (build, test, install, git commands)
- Memory: create_knowledge_item, list_knowledge_items

### CRITICAL RULES
✅ Execute changes with tools immediately
✅ Fix errors without asking permission
✅ Run verification commands (npm run build, npm test)
✅ Install missing packages automatically
❌ Never ask "Should I do X?" - just do it
❌ Never show code blocks when write_to_file should be used
❌ Never stop at first failure - debug and retry`;
    }

    private formatOpenAIError(error: any): string {
        let msg = error.message || 'Unknown API error';
        if (msg.includes('aiter method') || msg.includes('JSONResponse')) {
            return '❌ The AI Proxy returned an invalid response (JSON instead of Stream).\n\n' +
                'Possible causes:\n' +
                '1. Invalid API Key or Model Name\n' +
                '2. Rate limit reached\n' +
                '3. Check proxy logs for upstream errors';
        }
        return msg;
    }

    private safeJSONParse(text: string): any {
        try { return JSON.parse(text); } catch { return {}; }
    }
}
