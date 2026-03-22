/**
 * Ito - Token Counter
 * Token 计数和估算
 */

import { Message } from '../types';

/**
 * Token counting strategy
 */
export type TokenCountStrategy = 'simple' | 'openai';

/**
 * Token counter interface
 */
export interface TokenCounter {
  count(text: string): number;
  countMessages(messages: Message[]): number;
}

/**
 * Simple token estimator
 * 使用近似算法：平均每 4 个字符 = 1 token
 */
export class SimpleTokenCounter implements TokenCounter {
  private readonly charsPerToken: number;

  constructor(charsPerToken: number = 4) {
    this.charsPerToken = charsPerToken;
  }

  count(text: string): number {
    return Math.ceil(text.length / this.charsPerToken);
  }

  countMessages(messages: Message[]): number {
    let total = 0;

    for (const msg of messages) {
      // Role overhead (~4 tokens)
      total += 4;

      if (typeof msg.content === 'string') {
        total += this.count(msg.content);
      } else if (Array.isArray(msg.content)) {
        // Structured content
        for (const part of msg.content) {
          if (part.type === 'text') {
            total += this.count((part as any).text || '');
          } else if (part.type === 'tool_call') {
            total += this.count((part as any).name || '');
            total += this.count(JSON.stringify((part as any).arguments || {}));
          } else if (part.type === 'tool_result') {
            total += this.count((part as any).content || '');
          }
        }
      }

      // Message overhead (~2 tokens per message)
      total += 2;
    }

    return total;
  }
}

/**
 * OpenAI tokenizer using tiktoken (lazy loaded)
 * Note: Requires 'tiktoken' package to be installed
 */
export class OpenAITokenCounter implements TokenCounter {
  private encoder: any = null;
  private modelName: string;
  private loaded: boolean = false;

  constructor(modelName: string = 'gpt-4') {
    this.modelName = modelName;
  }

  private async loadEncoder(): Promise<void> {
    if (this.loaded) return;

    try {
      // Dynamic import of tiktoken (optional dependency)
      // @ts-ignore - tiktoken is an optional dependency
      const tiktoken = await import('tiktoken');
      const { encoding_for_model } = tiktoken;

      // Map model names
      const modelMap: Record<string, string> = {
        'gpt-4': 'gpt-4',
        'gpt-4o': 'gpt-4o',
        'gpt-4o-mini': 'gpt-4o',
        'gpt-3.5-turbo': 'gpt-3.5-turbo',
      };

      const model = modelMap[this.modelName] || 'gpt-4';
      this.encoder = await encoding_for_model(model as any);
      this.loaded = true;
    } catch (error) {
      console.warn('tiktoken not available, falling back to simple counter');
      // Don't throw, just mark as not loaded
      this.loaded = false;
    }
  }

  count(text: string): number {
    if (!this.encoder) {
      // Fallback to simple estimation
      return Math.ceil(text.length / 4);
    }
    return this.encoder.encode(text).length;
  }

  countMessages(messages: Message[]): number {
    if (!this.encoder) {
      // Fallback to simple counter
      const simple = new SimpleTokenCounter();
      return simple.countMessages(messages);
    }

    let total = 0;

    for (const msg of messages) {
      // Every message follows <im_start>{role/name}\n{content}<im_end>\n
      total += 4; // <im_start>, role, \n, <im_end>

      if (typeof msg.content === 'string') {
        total += this.encoder.encode(msg.content).length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            total += this.encoder.encode((part as any).text || '').length;
          } else if (part.type === 'tool_call') {
            total += this.encoder.encode((part as any).name || '').length;
            total += this.encoder.encode(JSON.stringify((part as any).arguments || {})).length;
          } else if (part.type === 'tool_result') {
            total += this.encoder.encode((part as any).content || '').length;
          }
        }
      }
    }

    total += 2; // Every reply is primed with <im_start>assistant

    return total;
  }

  /**
   * Initialize the encoder (async)
   */
  async init(): Promise<void> {
    await this.loadEncoder();
  }

  /**
   * Free encoder resources
   */
  free(): void {
    if (this.encoder) {
      this.encoder.free();
      this.encoder = null;
      this.loaded = false;
    }
  }
}

/**
 * Create a token counter based on strategy
 */
export function createTokenCounter(
  strategy?: 'simple',
  options?: { charsPerToken?: number }
): SimpleTokenCounter;
export function createTokenCounter(
  strategy?: 'openai',
  options?: { model?: string }
): OpenAITokenCounter;
export function createTokenCounter(
  strategy: TokenCountStrategy = 'simple',
  options?: any
): TokenCounter {
  switch (strategy) {
    case 'openai':
      return new OpenAITokenCounter(options?.model);
    case 'simple':
    default:
      return new SimpleTokenCounter(options?.charsPerToken);
  }
}
