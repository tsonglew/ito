/**
 * Ito - Tool Registry
 * 工具注册和管理
 */

import { z } from 'zod';
import { ToolDefinition, ToolSchema, ToolHandler } from '../types';

/**
 * Builder for creating tools with a fluent API
 */
export class ToolBuilder {
  private name: string = '';
  private description: string = '';
  private parameters: z.ZodType<any> = z.object({});
  private handler?: ToolHandler;

  /**
   * Set tool name
   */
  setName(name: string): this {
    this.name = name;
    return this;
  }

  /**
   * Set tool description
   */
  setDescription(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * Set parameter schema using Zod
   */
  setParameters<T extends z.ZodType<any>>(schema: T): this {
    this.parameters = schema;
    return this;
  }

  /**
   * Set the handler function
   */
  setHandler(handler: ToolHandler): this {
    this.handler = handler;
    return this;
  }

  /**
   * Build the tool definition
   */
  build(): ToolDefinition {
    if (!this.name) {
      throw new Error('Tool name is required');
    }
    if (!this.handler) {
      throw new Error('Tool handler is required');
    }

    return {
      schema: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
      handler: this.handler,
    };
  }
}

/**
 * Create a tool using builder pattern
 */
export function tool(name: string): ToolBuilder {
  return new ToolBuilder().setName(name);
}

/**
 * Registry for managing multiple tools
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a tool
   */
  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.schema.name)) {
      console.warn(`Tool "${definition.schema.name}" already registered, overwriting`);
    }
    this.tools.set(definition.schema.name, definition);
  }

  /**
   * Register multiple tools
   */
  registerAll(definitions: ToolDefinition[]): void {
    for (const def of definitions) {
      this.register(def);
    }
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Remove a tool
   */
  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get all tool schemas (for LLM)
   */
  getSchemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map(t => t.schema);
  }

  /**
   * Get all tool definitions
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get tool count
   */
  get size(): number {
    return this.tools.size;
  }
}

/**
 * Common parameter schemas
 */
export const commonSchemas = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
  array: <T extends z.ZodTypeAny>(schema: T) => z.array(schema),
  object: <T extends Record<string, z.ZodTypeAny>>(shape: T) => z.object(shape),

  // File operations
  filePath: z.string().describe('File path'),

  // Web operations
  url: z.string().url().describe('URL'),

  // Search/query
  query: z.string().describe('Search query'),

  // Pagination
  pagination: z.object({
    limit: z.number().optional().default(10),
    offset: z.number().optional().default(0),
  }),
};

/**
 * Example tool definitions
 */
export const exampleTools = {
  /**
   * Echo tool - for testing
   */
  echo: tool('echo')
    .setDescription('Echo back the input message')
    .setParameters(
      z.object({
        message: z.string().describe('Message to echo'),
      })
    )
    .setHandler(async (args) => {
      return args.message as string;
    })
    .build(),

  /**
   * Calculator tool
   */
  calculate: tool('calculate')
    .setDescription('Perform a mathematical calculation')
    .setParameters(
      z.object({
        expression: z.string().describe('Math expression to evaluate'),
      })
    )
    .setHandler(async (args) => {
      try {
        // Safe eval using Function constructor
        const result = new Function(`return ${args.expression}`)();
        return String(result);
      } catch (error) {
        return `Error: Invalid expression`;
      }
    })
    .build(),
};
