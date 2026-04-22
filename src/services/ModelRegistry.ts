/**
 * ModelRegistry.ts
 *
 * Central registry for all AI model providers (OpenAI-compatible, Gemini, Anthropic, Ollama).
 * Responsible for:
 *  - Discovering available models per provider
 *  - Providing a unified model list to the UI
 *  - Caching model lists and refreshing on demand
 *  - Validating provider connectivity
 */

import * as vscode from 'vscode';
import { OllamaService, OllamaModel } from './OllamaService';

export type ProviderType = 'openai' | 'gemini' | 'anthropic' | 'ollama' | 'openai-compatible';

export interface ModelInfo {
    id: string;           // The model identifier used in API calls
    displayName: string;  // Human-readable name
    provider: ProviderType;
    description?: string;
    contextWindow?: number;
    supportsTools?: boolean;
    isLocal?: boolean;    // True for Ollama / local models
    size?: string;        // For Ollama models (e.g., "7.2 GB")
    family?: string;      // Model family (llama, mistral, etc.)
}

export interface ProviderStatus {
    provider: ProviderType;
    healthy: boolean;
    message?: string;
    models: ModelInfo[];
    lastChecked: Date;
}

// ──────────────────────────────────────────────────────────────
// Static model lists for cloud providers
// ──────────────────────────────────────────────────────────────

const OPENAI_MODELS: ModelInfo[] = [
    { id: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai', contextWindow: 128000, supportsTools: true, description: 'Most capable GPT-4o model' },
    { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', provider: 'openai', contextWindow: 128000, supportsTools: true, description: 'Faster, cheaper GPT-4o' },
    { id: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', provider: 'openai', contextWindow: 128000, supportsTools: true },
    { id: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo', provider: 'openai', contextWindow: 16385, supportsTools: true },
    { id: 'o1', displayName: 'o1 (Reasoning)', provider: 'openai', contextWindow: 128000, supportsTools: false, description: 'Advanced reasoning model' },
    { id: 'o1-mini', displayName: 'o1-mini', provider: 'openai', contextWindow: 128000, supportsTools: false },
];

const GEMINI_MODELS: ModelInfo[] = [
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', provider: 'gemini', contextWindow: 1000000, supportsTools: true, description: 'Fast multimodal model' },
    { id: 'gemini-2.0-flash-lite', displayName: 'Gemini 2.0 Flash Lite', provider: 'gemini', contextWindow: 1000000, supportsTools: true },
    { id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', provider: 'gemini', contextWindow: 2000000, supportsTools: true, description: '2M context window' },
    { id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', provider: 'gemini', contextWindow: 1000000, supportsTools: true },
];

const ANTHROPIC_MODELS: ModelInfo[] = [
    { id: 'claude-opus-4-5', displayName: 'Claude Opus 4.5', provider: 'anthropic', contextWindow: 200000, supportsTools: true, description: 'Most capable Claude model' },
    { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', provider: 'anthropic', contextWindow: 200000, supportsTools: true, description: 'Balanced performance' },
    { id: 'claude-haiku-3-5', displayName: 'Claude Haiku 3.5', provider: 'anthropic', contextWindow: 200000, supportsTools: true, description: 'Fastest Claude model' },
    { id: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet', provider: 'anthropic', contextWindow: 200000, supportsTools: true },
    { id: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus', provider: 'anthropic', contextWindow: 200000, supportsTools: true },
];

// ──────────────────────────────────────────────────────────────

export class ModelRegistry {
    private ollamaService: OllamaService;
    private cache: Map<ProviderType, ProviderStatus> = new Map();
    private cacheMaxAgeMs = 60_000; // 1 minute
    private ollamaOfflineUntil = 0; // Cooldown for ollama checks if it's down

    constructor(private context: vscode.ExtensionContext) {
        const config = vscode.workspace.getConfiguration('cnx');
        const ollamaUrl = config.get<string>('ollamaBaseUrl') || 'http://localhost:11434';
        this.ollamaService = new OllamaService(ollamaUrl);

        // Re-initialize ollama service when settings change
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('cnx.ollamaBaseUrl')) {
                const newUrl = vscode.workspace.getConfiguration('cnx').get<string>('ollamaBaseUrl') || 'http://localhost:11434';
                this.ollamaService.updateBaseUrl(newUrl);
                this.invalidateCache('ollama');
            }
        });
    }

    public getOllamaService(): OllamaService {
        return this.ollamaService;
    }

    /**
     * Get all available models for a specific provider.
     * Returns cached results if fresh; otherwise fetches live.
     */
    public async getModelsForProvider(provider: ProviderType): Promise<ProviderStatus> {
        const cached = this.cache.get(provider);
        if (cached && (Date.now() - cached.lastChecked.getTime()) < this.cacheMaxAgeMs) {
            return cached;
        }
        return this.fetchProviderStatus(provider);
    }

    /**
     * Get all available models from configured providers only.
     *
     * Key resolution rules (mirrors AIService):
     *  • LLM_API_KEY env var → only applied to the CURRENTLY active provider
     *  • cnx.openaiApiKey    → unlocks OpenAI models
     *  • cnx.geminiApiKey    → unlocks Gemini models
     *  • cnx.anthropicApiKey → unlocks Anthropic models
     *  • Ollama reachable    → unlocks local models
     */
    public async getAllModels(): Promise<ModelInfo[]> {
        const config = vscode.workspace.getConfiguration('cnx');
        const activeProvider = config.get<string>('aiProvider') || 'openai';
        const envKey = process.env.LLM_API_KEY || '';

        const models: ModelInfo[] = [];

        // ── OpenAI ──────────────────────────────────────────────
        const openaiSpecific = config.get<string>('openaiApiKey') || process.env.OPENAI_API_KEY || '';
        const openaiKey = openaiSpecific || (activeProvider === 'openai' || activeProvider === 'openai-compatible' ? envKey : '');
        if (openaiKey) {
            models.push(...OPENAI_MODELS);
        }

        // ── Gemini ──────────────────────────────────────────────
        const geminiSpecific = config.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY || '';
        const geminiKey = geminiSpecific || (activeProvider === 'gemini' ? envKey : '');
        if (geminiKey) {
            models.push(...GEMINI_MODELS);
        }

        // ── Anthropic ───────────────────────────────────────────
        const anthropicSpecific = config.get<string>('anthropicApiKey') || process.env.ANTHROPIC_API_KEY || '';
        const anthropicKey = anthropicSpecific || (activeProvider === 'anthropic' ? envKey : '');
        if (anthropicKey) {
            models.push(...ANTHROPIC_MODELS);
        }

        // ── Ollama (local) ──────────────────────────────────────
        if (Date.now() > this.ollamaOfflineUntil) {
            try {
                const ollamaStatus = await Promise.race([
                    this.fetchOllamaStatus(),
                    new Promise<ProviderStatus>((_, reject) =>
                        setTimeout(() => reject(new Error('timeout')), 1500) // Reduced to 1.5s
                    ),
                ]) as ProviderStatus;

                if (ollamaStatus.healthy && ollamaStatus.models.length > 0) {
                    models.push(...ollamaStatus.models);
                } else {
                    this.ollamaOfflineUntil = Date.now() + 30000; // 30s cooldown
                }
            } catch {
                this.ollamaOfflineUntil = Date.now() + 30000; // 30s cooldown
            }
        }

        return models;
    }


    /**
     * Check connectivity and return available models for a provider.
     */
    public async fetchProviderStatus(provider: ProviderType): Promise<ProviderStatus> {
        const config = vscode.workspace.getConfiguration('cnx');

        let status: ProviderStatus;

        switch (provider) {
            case 'ollama':
                status = await this.fetchOllamaStatus();
                break;

            case 'openai':
            case 'openai-compatible': {
                const apiKey = config.get<string>('openaiApiKey') || process.env.OPENAI_API_KEY || '';
                const baseUrl = config.get<string>('openaiBaseUrl') || 'https://api.openai.com/v1';
                status = await this.fetchOpenAICompatibleStatus(provider, apiKey, baseUrl);
                break;
            }

            case 'gemini': {
                const apiKey = config.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY || '';
                status = {
                    provider: 'gemini',
                    healthy: !!apiKey,
                    message: apiKey ? undefined : 'No Gemini API key configured',
                    models: apiKey ? GEMINI_MODELS : [],
                    lastChecked: new Date(),
                };
                break;
            }

            case 'anthropic': {
                const apiKey = config.get<string>('anthropicApiKey') || process.env.ANTHROPIC_API_KEY || '';
                status = {
                    provider: 'anthropic',
                    healthy: !!apiKey,
                    message: apiKey ? undefined : 'No Anthropic API key configured',
                    models: apiKey ? ANTHROPIC_MODELS : [],
                    lastChecked: new Date(),
                };
                break;
            }

            default:
                status = {
                    provider,
                    healthy: false,
                    message: `Unknown provider: ${provider}`,
                    models: [],
                    lastChecked: new Date(),
                };
        }

        this.cache.set(provider, status);
        return status;
    }

    public invalidateCache(provider?: ProviderType): void {
        if (provider) {
            this.cache.delete(provider);
        } else {
            this.cache.clear();
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────

    private async fetchOllamaStatus(): Promise<ProviderStatus> {
        const health = await this.ollamaService.healthCheck();

        if (!health.healthy) {
            return {
                provider: 'ollama',
                healthy: false,
                message: health.error,
                models: [],
                lastChecked: new Date(),
            };
        }

        const ollamaModels = await this.ollamaService.listModels();
        const models: ModelInfo[] = ollamaModels.map(m => this.ollamaModelToModelInfo(m));

        return {
            provider: 'ollama',
            healthy: true,
            message: `Ollama ${health.version} — ${models.length} model(s) available`,
            models,
            lastChecked: new Date(),
        };
    }

    private async fetchOpenAICompatibleStatus(
        provider: ProviderType,
        apiKey: string,
        baseUrl: string
    ): Promise<ProviderStatus> {
        if (!apiKey) {
            return {
                provider,
                healthy: false,
                message: 'No API key configured',
                models: provider === 'openai' ? [] : OPENAI_MODELS,
                lastChecked: new Date(),
            };
        }

        // For known OpenAI endpoint, return static list (avoid extra API calls)
        if (baseUrl.includes('api.openai.com')) {
            return {
                provider: 'openai',
                healthy: true,
                models: OPENAI_MODELS,
                lastChecked: new Date(),
            };
        }

        // For custom gateways (LiteLLM, vLLM, LocalAI, etc.), try to list models dynamically
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 8000);
            const res = await fetch(`${baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                signal: controller.signal,
            });

            if (res.ok) {
                const body: any = await res.json();
                const dynamicModels: ModelInfo[] = (body.data || []).map((m: any) => ({
                    id: m.id,
                    displayName: m.id,
                    provider: 'openai-compatible' as ProviderType,
                    supportsTools: true,
                    description: `Custom gateway: ${baseUrl}`,
                }));

                return {
                    provider: 'openai-compatible',
                    healthy: true,
                    message: `${dynamicModels.length} model(s) from ${baseUrl}`,
                    models: dynamicModels,
                    lastChecked: new Date(),
                };
            }
        } catch (e) {
            // Fall through: return the static OpenAI list as fallback
        }

        return {
            provider: 'openai-compatible',
            healthy: true, // API key is set; assume reachable
            message: `Custom gateway: ${baseUrl}`,
            models: OPENAI_MODELS,
            lastChecked: new Date(),
        };
    }

    private ollamaModelToModelInfo(m: OllamaModel): ModelInfo {
        return {
            id: m.name,
            displayName: m.displayName,
            provider: 'ollama',
            supportsTools: m.supportsTools,
            isLocal: true,
            size: m.size,
            family: m.family,
            description: `Local · ${m.size}${m.supportsTools ? ' · Tool calling' : ''}`,
        };
    }
}
