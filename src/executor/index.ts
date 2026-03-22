/**
 * Ito - Tool Executor
 * 工具执行引擎（并行 + 超时控制）
 */

import { ToolDefinition, ToolContext, ToolResult, Message, Harness } from '../types';

export interface ExecutorOptions {
  timeout?: number; // 单个工具超时（毫秒）
  maxConcurrent?: number; // 最大并发数
  retryCount?: number; // 失败重试次数
  retryDelay?: number; // 重试延迟（毫秒）
}

export interface ExecutionResult {
  toolCallId: string;
  toolName: string;
  result: ToolResult;
  duration: number; // 执行时间（毫秒）
  attempts: number; // 尝试次数
}

export interface ParallelExecutionResult {
  results: ExecutionResult[];
  totalDuration: number;
  successCount: number;
  errorCount: number;
}

/**
 * Tool executor with parallel execution and timeout support
 */
export class ToolExecutor {
  private options: Required<ExecutorOptions>;

  constructor(options?: ExecutorOptions) {
    this.options = {
      timeout: options?.timeout || 30000, // 30 秒
      maxConcurrent: options?.maxConcurrent || 5,
      retryCount: options?.retryCount || 0,
      retryDelay: options?.retryDelay || 1000,
    };
  }

  /**
   * Execute a single tool with timeout and retry
   */
  async execute(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    context: ToolContext,
    options?: Partial<ExecutorOptions>
  ): Promise<ExecutionResult> {
    const timeout = options?.timeout || this.options.timeout;
    const retryCount = options?.retryCount || this.options.retryCount;
    const retryDelay = options?.retryDelay || this.options.retryDelay;

    const startTime = Date.now();
    let attempts = 0;
    let lastError: Error | null = null;

    // Retry loop
    for (let i = 0; i <= retryCount; i++) {
      attempts++;
      try {
        const result = await this.executeWithTimeout(tool, args, context, timeout);
        const duration = Date.now() - startTime;

        return {
          toolCallId: '', // Will be set by caller
          toolName: tool.schema.name,
          result: typeof result === 'string' ? { content: result } : result,
          duration,
          attempts,
        };
      } catch (error) {
        lastError = error as Error;
        if (i < retryCount) {
          await this.delay(retryDelay);
        }
      }
    }

    // All retries failed
    const duration = Date.now() - startTime;
    return {
      toolCallId: '',
      toolName: tool.schema.name,
      result: {
        content: `Error after ${attempts} attempts: ${lastError?.message}`,
        is_error: true,
      },
      duration,
      attempts,
    };
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeParallel(
    toolCalls: Array<{
      id: string;
      tool: ToolDefinition;
      args: Record<string, unknown>;
      context: ToolContext;
    }>,
    options?: Partial<ExecutorOptions>
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();
    const maxConcurrent = options?.maxConcurrent || this.options.maxConcurrent;

    // Split into batches for concurrency control
    const results: ExecutionResult[] = [];

    for (let i = 0; i < toolCalls.length; i += maxConcurrent) {
      const batch = toolCalls.slice(i, i + maxConcurrent);

      const batchResults = await Promise.all(
        batch.map(async ({ id, tool, args, context }) => {
          const result = await this.execute(tool, args, context, options);
          result.toolCallId = id;
          return result;
        })
      );

      results.push(...batchResults);
    }

    const totalDuration = Date.now() - startTime;
    const successCount = results.filter(r => !r.result.is_error).length;
    const errorCount = results.length - successCount;

    return {
      results,
      totalDuration,
      successCount,
      errorCount,
    };
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    context: ToolContext,
    timeout: number
  ): Promise<string | ToolResult> {
    return new Promise<string | ToolResult>((resolve, reject) => {
      // Create timeout timer
      const timer = setTimeout(() => {
        reject(new Error(`Tool "${tool.schema.name}" timed out after ${timeout}ms`));
      }, timeout);

      // Execute tool
      Promise.resolve(tool.handler(args, context))
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a tool executor
 */
export function createToolExecutor(options?: ExecutorOptions): ToolExecutor {
  return new ToolExecutor(options);
}
