/**
 * Token Budget Management System
 * Tracks and manages token usage to stay within limits
 */

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
}

export interface BudgetConfig {
    maxTokensPerRequest: number;
    maxTokensPerConversation: number;
    warningThreshold: number; // Percentage (0-100)
}

export class TokenBudgetManager {
    private conversationTokens: number = 0;
    private conversationCachedTokens: number = 0;
    private requestTokens: number = 0;
    private config: BudgetConfig;
    private onWarning?: (message: string) => void;

    constructor(config?: Partial<BudgetConfig>) {
        this.config = {
            maxTokensPerRequest: config?.maxTokensPerRequest || 8000,
            maxTokensPerConversation: config?.maxTokensPerConversation || 200000,
            warningThreshold: config?.warningThreshold || 80
        };
    }

    /**
     * Set warning callback
     */
    setWarningCallback(callback: (message: string) => void) {
        this.onWarning = callback;
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<BudgetConfig>) {
        this.config = { ...this.config, ...config };
    }

    /**
     * Record token usage from a request
     */
    recordUsage(usage: TokenUsage) {
        this.requestTokens = usage.totalTokens;
        this.conversationTokens += usage.totalTokens;
        this.conversationCachedTokens += usage.cachedTokens || 0;

        // Check thresholds
        this.checkThresholds();
    }

    /**
     * Estimate tokens for text (rough approximation: 1 token ≈ 4 characters)
     */
    estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    /**
     * Check if we can afford a request
     */
    canAffordRequest(estimatedTokens: number): boolean {
        return (
            estimatedTokens <= this.config.maxTokensPerRequest &&
            this.conversationTokens + estimatedTokens <= this.config.maxTokensPerConversation
        );
    }

    /**
     * Get remaining budget
     */
    getRemainingBudget(): {
        request: number;
        conversation: number;
        percentUsed: number;
    } {
        const conversationRemaining = this.config.maxTokensPerConversation - this.conversationTokens;
        const percentUsed = (this.conversationTokens / this.config.maxTokensPerConversation) * 100;

        return {
            request: this.config.maxTokensPerRequest,
            conversation: conversationRemaining,
            percentUsed: Math.round(percentUsed)
        };
    }

    /**
     * Get usage summary
     */
    getUsageSummary(): string {
        const remaining = this.getRemainingBudget();
        return `Token Budget: ${this.conversationTokens.toLocaleString()}/${this.config.maxTokensPerConversation.toLocaleString()} (${remaining.percentUsed}% used)`;
    }

    /**
     * Check thresholds and emit warnings
     */
    private checkThresholds() {
        const remaining = this.getRemainingBudget();

        if (remaining.percentUsed >= this.config.warningThreshold) {
            const message = `⚠️ Token budget warning: ${remaining.percentUsed}% used (${this.conversationTokens.toLocaleString()}/${this.config.maxTokensPerConversation.toLocaleString()})`;
            if (this.onWarning) {
                this.onWarning(message);
            }
        }

        if (remaining.conversation <= 0) {
            const message = '🚨 Token budget exhausted! Consider starting a new conversation.';
            if (this.onWarning) {
                this.onWarning(message);
            }
        }
    }

    /**
     * Reset conversation budget
     */
    resetConversation() {
        this.conversationTokens = 0;
        this.conversationCachedTokens = 0;
        this.requestTokens = 0;
    }

    /**
     * Prune context to fit within budget
     * Returns pruned history
     */
    pruneContext(history: any[], targetTokens: number): any[] {
        if (history.length === 0) return history;

        // Keep system messages and recent messages
        const systemMessages = history.filter(m => m.role === 'system');
        const userMessages = history.filter(m => m.role !== 'system');

        // Estimate tokens for each message
        const messagesWithTokens = userMessages.map(msg => ({
            message: msg,
            tokens: this.estimateTokens(JSON.stringify(msg))
        }));

        // Keep most recent messages that fit in budget
        let totalTokens = systemMessages.reduce((sum, msg) =>
            sum + this.estimateTokens(JSON.stringify(msg)), 0);

        const prunedMessages = [...systemMessages];

        // Add messages from most recent to oldest
        for (let i = messagesWithTokens.length - 1; i >= 0; i--) {
            const msgWithTokens = messagesWithTokens[i];
            if (totalTokens + msgWithTokens.tokens <= targetTokens) {
                prunedMessages.unshift(msgWithTokens.message);
                totalTokens += msgWithTokens.tokens;
            } else {
                break;
            }
        }

        return prunedMessages;
    }

    /**
     * Get budget status for display
     */
    getBudgetStatus(): {
        used: number;
        cached: number;
        total: number;
        remaining: number;
        percentUsed: number;
        status: 'healthy' | 'warning' | 'critical';
    } {
        const remaining = this.getRemainingBudget();
        let status: 'healthy' | 'warning' | 'critical' = 'healthy';

        if (remaining.percentUsed >= 95) {
            status = 'critical';
        } else if (remaining.percentUsed >= this.config.warningThreshold) {
            status = 'warning';
        }

        return {
            used: this.conversationTokens,
            cached: this.conversationCachedTokens,
            total: this.config.maxTokensPerConversation,
            remaining: remaining.conversation,
            percentUsed: remaining.percentUsed,
            status
        };
    }
}
