/**
 * Ito - Error Handling
 * 错误处理和恢复策略
 */

import { Message } from '../types';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for Ito
 */
export class ItoError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ItoError';
  }
}

/**
 * LLM provider error
 */
export class LLMError extends ItoError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly retryable: boolean = true
  ) {
    super(message, 'LLM_ERROR');
    this.name = 'LLMError';
  }
}

/**
 * Tool execution error
 */
export class ToolError extends ItoError {
  constructor(
    message: string,
    public readonly toolName: string,
    public readonly args: Record<string, unknown>
  ) {
    super(message, 'TOOL_ERROR');
    this.name = 'ToolError';
  }
}

/**
 * Context limit error
 */
export class ContextLimitError extends ItoError {
  constructor(
    message: string,
    public readonly currentTokens: number,
    public readonly maxTokens: number
  ) {
    super(message, 'CONTEXT_LIMIT');
    this.name = 'ContextLimitError';
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends ItoError {
  constructor(
    message: string,
    public readonly timeoutMs: number
  ) {
    super(message, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

/**
 * Validation error
 */
export class ValidationError extends ItoError {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

// ============================================================================
// Retry Strategy
// ============================================================================

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['LLM_ERROR', 'TIMEOUT'],
};

/**
 * Execute with retry and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;
  let delay = cfg.initialDelayMs;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      const errorCode = (error as any).code || 'UNKNOWN';
      if (!cfg.retryableErrors.includes(errorCode)) {
        throw error;
      }

      // Last attempt, throw
      if (attempt === cfg.maxRetries) {
        throw error;
      }

      // Wait before retry
      await sleep(delay);
      delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelayMs);
    }
  }

  throw lastError;
}

// ============================================================================
// Error Recovery Strategy
// ============================================================================

export type RecoveryStrategy = 'retry' | 'fallback' | 'skip' | 'abort';

export interface RecoveryAction {
  strategy: RecoveryStrategy;
  fallbackValue?: any;
  maxRetries?: number;
}

/**
 * Error recovery manager
 */
export class ErrorRecovery {
  private strategies: Map<string, RecoveryAction> = new Map();

  /**
   * Register a recovery strategy for an error code
   */
  register(errorCode: string, action: RecoveryAction): void {
    this.strategies.set(errorCode, action);
  }

  /**
   * Get recovery action for an error
   */
  getAction(error: Error): RecoveryAction {
    const errorCode = (error as any).code || 'UNKNOWN';
    return this.strategies.get(errorCode) || { strategy: 'abort' };
  }

  /**
   * Execute with recovery
   */
  async execute<T>(
    fn: () => Promise<T>,
    errorCode?: string
  ): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      const action = this.getAction(error as Error);

      switch (action.strategy) {
        case 'retry':
          return withRetry(fn, { maxRetries: action.maxRetries || 3 });

        case 'fallback':
          return action.fallbackValue;

        case 'skip':
          return undefined;

        case 'abort':
        default:
          throw error;
      }
    }
  }
}

// ============================================================================
// Circuit Breaker
// ============================================================================

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker for protecting against cascading failures
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private config: Required<CircuitBreakerConfig>;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold || 5,
      resetTimeoutMs: config?.resetTimeoutMs || 60000,
    };
  }

  /**
   * Execute through circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should be reset
    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = 'half-open';
      } else {
        throw new ItoError('Circuit breaker is open', 'CIRCUIT_OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap error with context
 */
export function wrapError(error: unknown, context: string): ItoError {
  if (error instanceof ItoError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ItoError(`${context}: ${message}`, 'WRAPPED_ERROR');
}

/**
 * Create error from any thrown value
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
