/**
 * Ito - Agent Harness Framework
 * 糸：编织智能
 *
 * A minimal, TypeScript-first framework for building AI agents
 */

// Core exports
export { ItoHarness, createHarness } from './core/harness';
export { ToolBuilder, ToolRegistry, tool, exampleTools } from './tools/registry';

// LLM Providers
export { OpenAIProvider, createOpenAIProvider } from './llm/openai';
export { AnthropicProvider, createAnthropicProvider } from './llm/anthropic';
export { OllamaProvider, createOllamaProvider, listOllamaModels } from './llm/ollama';
export { createProvider, ProviderRegistry } from './llm/factory';
export type { ProviderType } from './llm/factory';

// Context Management
export { SimpleTokenCounter, OpenAITokenCounter, createTokenCounter } from './context/tokenizer';
export type { TokenCounter, TokenCountStrategy } from './context/tokenizer';
export { ContextManager, createContextManager } from './context/manager';
export type { ContextManagerConfig, TruncationResult } from './context/manager';

// Type exports
export type {
  // Messages
  Message,
  MessageRole,
  MessageContent,
  TextContent,
  ToolCallContent,
  ToolResultContent,

  // Tools
  ToolSchema,
  ToolDefinition,
  ToolHandler,
  ToolContext,
  ToolResult,

  // LLM
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,

  // Harness
  HarnessConfig,
  HarnessState,
  Harness,

  // Executor
  ExecutorConfig,
  Executor,

  // Utils
  DeepPartial,
  Result,
} from './types';

/**
 * Quick start example:
 *
 * ```typescript
 * import { createHarness, createOpenAIProvider, tool } from 'ito';
 * import { z } from 'zod';
 *
 * const provider = createOpenAIProvider({
 *   apiKey: process.env.OPENAI_API_KEY!,
 * });
 *
 * const harness = createHarness({
 *   provider,
 *   systemPrompt: 'You are a helpful assistant.',
 * });
 *
 * // Register a tool
 * harness.registerTool(
 *   tool('get_weather')
 *     .setDescription('Get current weather for a location')
 *     .setParameters(z.object({
 *       location: z.string().describe('City name'),
 *     }))
 *     .setHandler(async (args) => {
 *       // Your weather API call here
 *       return `Weather in ${args.location}: Sunny, 72°F`;
 *     })
 *     .build()
 * );
 *
 * // Run
 * const result = await harness.run("What's the weather in Tokyo?");
 * console.log(result);
 * ```
 */
