/**
 * Ito - Context Manager
 * 上下文窗口管理
 */

import { Message } from '../types';
import { TokenCounter, SimpleTokenCounter } from './tokenizer';

export interface ContextManagerConfig {
  maxTokens: number;
  tokenCounter?: TokenCounter;
  preserveSystemPrompt?: boolean;
  truncationStrategy?: 'oldest' | 'summary';
}

/**
 * Truncation result
 */
export interface TruncationResult {
  messages: Message[];
  removedCount: number;
  tokensBefore: number;
  tokensAfter: number;
}

/**
 * Context manager for handling message history and token limits
 */
export class ContextManager {
  private messages: Message[] = [];
  private config: Required<ContextManagerConfig>;
  private tokenCounter: TokenCounter;

  constructor(config: ContextManagerConfig) {
    this.config = {
      maxTokens: config.maxTokens || 4096,
      tokenCounter: config.tokenCounter || new SimpleTokenCounter(),
      preserveSystemPrompt: config.preserveSystemPrompt ?? true,
      truncationStrategy: config.truncationStrategy || 'oldest',
    };
    this.tokenCounter = this.config.tokenCounter;
  }

  /**
   * Add a message to history
   */
  add(message: Message): void {
    this.messages.push(message);
  }

  /**
   * Add multiple messages
   */
  addMany(messages: Message[]): void {
    this.messages.push(...messages);
  }

  /**
   * Get all messages
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get current token count
   */
  getTokenCount(): number {
    return this.tokenCounter.countMessages(this.messages);
  }

  /**
   * Check if context is within limits
   */
  isWithinLimit(): boolean {
    return this.getTokenCount() <= this.config.maxTokens;
  }

  /**
   * Get remaining tokens
   */
  getRemainingTokens(): number {
    return Math.max(0, this.config.maxTokens - this.getTokenCount());
  }

  /**
   * Truncate messages to fit within token limit
   */
  truncate(maxTokens?: number): TruncationResult {
    const targetTokens = maxTokens || this.config.maxTokens;
    const tokensBefore = this.getTokenCount();

    if (tokensBefore <= targetTokens) {
      return {
        messages: this.messages,
        removedCount: 0,
        tokensBefore,
        tokensAfter: tokensBefore,
      };
    }

    let removedCount = 0;
    const systemMessages: Message[] = [];
    const otherMessages: Message[] = [];

    // Separate system messages
    for (const msg of this.messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg);
      } else {
        otherMessages.push(msg);
      }
    }

    // Try removing oldest messages first
    let truncatedMessages = [...otherMessages];

    while (truncatedMessages.length > 0) {
      const testMessages = [...systemMessages, ...truncatedMessages];
      const tokens = this.tokenCounter.countMessages(testMessages);

      if (tokens <= targetTokens) {
        break;
      }

      // Remove oldest non-system message
      truncatedMessages.shift();
      removedCount++;
    }

    const finalMessages = [...systemMessages, ...truncatedMessages];
    const tokensAfter = this.tokenCounter.countMessages(finalMessages);

    this.messages = finalMessages;

    return {
      messages: finalMessages,
      removedCount,
      tokensBefore,
      tokensAfter,
    };
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Clear but preserve system prompt
   */
  clearExceptSystem(): void {
    this.messages = this.messages.filter(m => m.role === 'system');
  }

  /**
   * Get the last N messages
   */
  getLast(n: number): Message[] {
    return this.messages.slice(-n);
  }

  /**
   * Get messages within a token budget
   */
  getWithinBudget(budget: number): Message[] {
    const result: Message[] = [];
    let tokens = 0;

    // Add from the end (most recent)
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      const msgTokens = this.tokenCounter.countMessages([msg]);

      if (tokens + msgTokens > budget) {
        break;
      }

      result.unshift(msg);
      tokens += msgTokens;
    }

    // Ensure system prompt is included if present
    if (this.config.preserveSystemPrompt) {
      const systemMsg = this.messages.find(m => m.role === 'system');
      if (systemMsg && !result.includes(systemMsg)) {
        result.unshift(systemMsg);
      }
    }

    return result;
  }

  /**
   * Compact messages by summarizing old ones
   * (Placeholder - requires LLM for summarization)
   */
  async compact(summarizer: (messages: Message[]) => Promise<string>): Promise<void> {
    if (this.messages.length <= 4) return; // Nothing to compact

    const systemMessages = this.messages.filter(m => m.role === 'system');
    const recentMessages = this.messages.slice(-2); // Keep last 2
    const oldMessages = this.messages.filter(
      m => m.role !== 'system' && !recentMessages.includes(m)
    );

    if (oldMessages.length === 0) return;

    // Generate summary
    const summary = await summarizer(oldMessages);

    // Replace old messages with summary
    this.messages = [
      ...systemMessages,
      {
        role: 'user',
        content: `[Previous conversation summary]\n${summary}`,
      },
      ...recentMessages,
    ];
  }

  /**
   * Export messages to JSON
   */
  export(): string {
    return JSON.stringify(this.messages, null, 2);
  }

  /**
   * Import messages from JSON
   */
  import(json: string): void {
    try {
      const messages = JSON.parse(json) as Message[];
      this.messages = messages;
    } catch (error) {
      throw new Error(`Failed to import messages: ${error}`);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    messageCount: number;
    tokenCount: number;
    maxTokens: number;
    remainingTokens: number;
    utilizationPercent: number;
  } {
    const tokenCount = this.getTokenCount();
    return {
      messageCount: this.messages.length,
      tokenCount,
      maxTokens: this.config.maxTokens,
      remainingTokens: this.config.maxTokens - tokenCount,
      utilizationPercent: Math.round((tokenCount / this.config.maxTokens) * 100),
    };
  }
}

/**
 * Create a context manager
 */
export function createContextManager(config?: Partial<ContextManagerConfig>): ContextManager {
  const defaultConfig: ContextManagerConfig = {
    maxTokens: 4096,
    tokenCounter: config?.tokenCounter,
    preserveSystemPrompt: config?.preserveSystemPrompt ?? true,
    truncationStrategy: config?.truncationStrategy || 'oldest',
  };

  return new ContextManager({
    ...defaultConfig,
    ...config,
    maxTokens: config?.maxTokens || 4096,
  });
}
