/**
 * Ito - Core Harness Implementation
 * 核心循环：LLM → 工具调用 → 结果 → LLM → ...
 */

import {
  Harness,
  HarnessConfig,
  HarnessState,
  Message,
  ToolDefinition,
  ToolSchema,
  ToolContext,
  LLMResponse,
} from '../types';
import { ToolExecutor, ExecutorOptions } from '../executor';

export class ItoHarness implements Harness {
  config: HarnessConfig;
  state: HarnessState;
  tools: Map<string, ToolDefinition>;
  private executor: ToolExecutor;

  constructor(config: HarnessConfig & { executorOptions?: ExecutorOptions }) {
    this.config = {
      maxIterations: 10,
      maxTokens: 4096,
      ...config,
    };

    this.state = {
      messages: [],
      iterations: 0,
      status: 'idle',
    };

    this.tools = new Map();
    this.executor = new ToolExecutor(config.executorOptions);

    // Add system prompt if provided
    if (this.config.systemPrompt) {
      this.state.messages.push({
        role: 'system',
        content: this.config.systemPrompt,
      });
    }
  }

  /**
   * Register a tool
   */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.schema.name, tool);
  }

  /**
   * Run with a user input string
   */
  async run(input: string): Promise<string> {
    const message: Message = {
      role: 'user',
      content: input,
    };

    return this.runWithMessages([message]);
  }

  /**
   * Run with pre-built messages
   */
  async runWithMessages(messages: Message[]): Promise<string> {
    // Add new messages
    this.state.messages.push(...messages);
    this.state.status = 'running';

    try {
      const result = await this.loop();
      this.state.status = 'done';
      return result;
    } catch (error) {
      this.state.status = 'error';
      this.state.lastError = error as Error;
      this.config.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Main agent loop
   */
  private async loop(): Promise<string> {
    const maxIter = this.config.maxIterations ?? 10;

    while (this.state.iterations < maxIter) {
      this.state.iterations++;

      // Get tool schemas
      const toolSchemas = Array.from(this.tools.values()).map(t => t.schema);

      // Call LLM
      const response = await this.config.provider.chat(
        this.state.messages,
        toolSchemas
      );

      // Handle response
      const assistantMessage = this.buildAssistantMessage(response);
      this.state.messages.push(assistantMessage);
      this.config.onMessage?.(assistantMessage);

      // Check stop reason
      if (response.stop_reason === 'end_turn') {
        // Extract text content
        return this.extractText(response.content);
      }

      if (response.stop_reason === 'tool_use' && response.tool_calls) {
        // Execute all tool calls in parallel
        const toolCalls = response.tool_calls.map(tc => {
          const tool = this.tools.get(tc.name);
          return {
            id: tc.id,
            tool: tool!,
            args: tc.arguments,
            context: {
              harness: this,
              message: this.state.messages[this.state.messages.length - 1],
            } as ToolContext,
          };
        }).filter(tc => tc.tool); // Filter out unknown tools

        // Execute in parallel
        const execResult = await this.executor.executeParallel(toolCalls);

        // Notify callbacks
        for (const result of execResult.results) {
          if (result.result.is_error) {
            this.config.onToolResult?.(result.toolName, `Error: ${result.result.content}`);
          } else {
            this.config.onToolResult?.(result.toolName, result.result.content);
          }
        }

        // Add tool results to messages
        for (const result of execResult.results) {
          const toolResultMessage: Message = {
            role: 'tool',
            content: [{
              type: 'tool_result',
              tool_call_id: result.toolCallId,
              content: result.result.content,
              is_error: result.result.is_error,
            }],
          };
          this.state.messages.push(toolResultMessage);
        }

        continue;
      }

      if (response.stop_reason === 'max_tokens') {
        // TODO: Handle context truncation
        throw new Error('Max tokens reached - context management not implemented');
      }

      if (response.stop_reason === 'error') {
        throw new Error('LLM returned error status');
      }
    }

    throw new Error(`Max iterations (${maxIter}) reached without completion`);
  }

  /**
   * Execute a single tool
   */
  private async executeTool(
    id: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<{ tool_call_id: string; content: string; is_error?: boolean }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        tool_call_id: id,
        content: `Error: Unknown tool "${name}"`,
        is_error: true,
      };
    }

    this.config.onToolCall?.(name, args);

    try {
      // Validate args with Zod schema
      const validatedArgs = tool.schema.parameters.parse(args);

      const context: ToolContext = {
        harness: this,
        message: this.state.messages[this.state.messages.length - 1],
      };

      const result = await tool.handler(validatedArgs, context);
      const content = typeof result === 'string' ? result : result.content;
      const is_error = typeof result === 'string' ? false : result.is_error;

      this.config.onToolResult?.(name, content);

      return { tool_call_id: id, content, is_error };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.config.onToolResult?.(name, `Error: ${errorMessage}`);
      return {
        tool_call_id: id,
        content: `Error: ${errorMessage}`,
        is_error: true,
      };
    }
  }

  /**
   * Build assistant message from LLM response
   */
  private buildAssistantMessage(response: LLMResponse): Message {
    if (typeof response.content === 'string') {
      return { role: 'assistant', content: response.content };
    }

    const parts: any[] = [];

    // Add text content
    for (const part of response.content) {
      if (part.type === 'text') {
        parts.push(part);
      }
    }

    // Add tool calls
    if (response.tool_calls) {
      for (const tc of response.tool_calls) {
        parts.push({
          type: 'tool_call',
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        });
      }
    }

    return { role: 'assistant', content: parts };
  }

  /**
   * Extract text from response content
   */
  private extractText(content: string | any[]): string {
    if (typeof content === 'string') return content;

    const textParts = content
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text);

    return textParts.join('\n');
  }

  /**
   * Reset harness state
   */
  reset(): void {
    this.state = {
      messages: this.config.systemPrompt
        ? [{ role: 'system', content: this.config.systemPrompt }]
        : [],
      iterations: 0,
      status: 'idle',
    };
  }
}

/**
 * Create a new harness instance
 */
export function createHarness(config: HarnessConfig): Harness {
  return new ItoHarness(config);
}
