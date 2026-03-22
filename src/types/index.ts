/**
 * Ito - Agent Harness Types
 * 糸：编织智能的类型定义
 */

import { z } from 'zod';

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolCallContent {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_call_id: string;
  content: string;
  is_error?: boolean;
}

export type MessageContent = TextContent | ToolCallContent | ToolResultContent;

export interface Message {
  role: MessageRole;
  content: string | MessageContent[];
  name?: string;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolSchema {
  name: string;
  description: string;
  parameters: z.ZodType<any>; // Zod schema for validation
}

export interface ToolDefinition {
  schema: ToolSchema;
  handler: ToolHandler;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<string | ToolResult>;

export interface ToolContext {
  harness: Harness;
  message: Message;
}

export interface ToolResult {
  content: string;
  is_error?: boolean;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// LLM Provider Types
// ============================================================================

export interface LLMProvider {
  name: string;
  chat(messages: Message[], tools?: ToolSchema[]): Promise<LLMResponse>;
  stream?(messages: Message[], tools?: ToolSchema[]): AsyncIterable<LLMStreamChunk>;
}

export interface LLMResponse {
  content: string | MessageContent[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMStreamChunk {
  delta?: string;
  tool_call?: {
    id: string;
    name: string;
    arguments: string; // JSON string, may be partial
  };
  done: boolean;
}

// ============================================================================
// Harness Types
// ============================================================================

export interface HarnessConfig {
  provider: LLMProvider;
  systemPrompt?: string;
  maxIterations?: number;
  maxTokens?: number;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string) => void;
  onMessage?: (message: Message) => void;
  onError?: (error: Error) => void;
}

export interface HarnessState {
  messages: Message[];
  iterations: number;
  status: 'idle' | 'running' | 'waiting' | 'done' | 'error';
  lastError?: Error;
}

export interface Harness {
  config: HarnessConfig;
  state: HarnessState;
  tools: Map<string, ToolDefinition>;
  registerTool(tool: ToolDefinition): void;
  run(input: string): Promise<string>;
  runWithMessages(messages: Message[]): Promise<string>;
  reset(): void;
}

// ============================================================================
// Executor Types
// ============================================================================

export interface ExecutorConfig {
  timeout?: number; // ms
  sandbox?: boolean;
  maxConcurrent?: number;
}

export interface Executor {
  execute(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;
}

// ============================================================================
// Context Management Types
// ============================================================================

export interface ContextManager {
  add(message: Message): void;
  truncate(maxTokens: number): void;
  summarize(): Promise<string>;
  getMessages(): Message[];
  clear(): void;
}

// ============================================================================
// Utility Types
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface Result<T, E = Error> {
  ok: boolean;
  value?: T;
  error?: E;
}
