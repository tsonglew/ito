/**
 * Ito - Provider Factory
 * 统一的 provider 创建接口
 */

import { LLMProvider } from '../types';
import { OpenAIProvider, OpenAIConfig } from './openai';
import { AnthropicProvider, AnthropicConfig } from './anthropic';
import { OllamaProvider, OllamaConfig } from './ollama';

export type ProviderType = 'openai' | 'anthropic' | 'ollama';

export interface ProviderConfig {
  openai?: OpenAIConfig;
  anthropic?: AnthropicConfig;
  ollama?: OllamaConfig;
}

/**
 * Create a provider by type
 */
export function createProvider(
  type: 'openai',
  config: OpenAIConfig
): OpenAIProvider;
export function createProvider(
  type: 'anthropic',
  config: AnthropicConfig
): AnthropicProvider;
export function createProvider(
  type: 'ollama',
  config: OllamaConfig
): OllamaProvider;
export function createProvider(
  type: ProviderType,
  config: any
): LLMProvider {
  switch (type) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

/**
 * Provider registry for managing multiple providers
 */
export class ProviderRegistry {
  private providers: Map<string, LLMProvider> = new Map();

  /**
   * Register a provider
   */
  register(name: string, provider: LLMProvider): void {
    this.providers.set(name, provider);
  }

  /**
   * Get a provider by name
   */
  get(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Check if a provider exists
   */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Remove a provider
   */
  remove(name: string): boolean {
    return this.providers.delete(name);
  }

  /**
   * Get all provider names
   */
  list(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Clear all providers
   */
  clear(): void {
    this.providers.clear();
  }
}
