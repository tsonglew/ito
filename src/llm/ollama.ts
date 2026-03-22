/**
 * Ito - Ollama Provider
 * 本地模型支持 (Ollama)
 */

import { LLMProvider, LLMResponse, LLMStreamChunk, Message, ToolSchema } from '../types';

export interface OllamaConfig {
  baseUrl?: string;
  model: string;
  temperature?: number;
  numCtx?: number; // Context window size
}

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private config: Required<OllamaConfig>;

  constructor(config: OllamaConfig) {
    this.config = {
      baseUrl: config.baseUrl || 'http://localhost:11434',
      model: config.model,
      temperature: config.temperature ?? 0.7,
      numCtx: config.numCtx || 4096,
    };
  }

  async chat(messages: Message[], tools?: ToolSchema[]): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: this.formatMessages(messages),
        tools: tools ? this.formatTools(tools) : undefined,
        options: {
          temperature: this.config.temperature,
          num_ctx: this.config.numCtx,
        },
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const data = await response.json();
    return this.parseResponse(data);
  }

  async *stream(messages: Message[], tools?: ToolSchema[]): AsyncIterable<LLMStreamChunk> {
    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: this.formatMessages(messages),
        tools: tools ? this.formatTools(tools) : undefined,
        options: {
          temperature: this.config.temperature,
          num_ctx: this.config.numCtx,
        },
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line);

          if (parsed.done) {
            yield { done: true };
            return;
          }

          if (parsed.message?.content) {
            yield { delta: parsed.message.content, done: false };
          }

          // Tool calls (if supported by the model)
          if (parsed.message?.tool_calls) {
            for (const tc of parsed.message.tool_calls) {
              yield {
                tool_call: {
                  id: tc.id || `tool_${Date.now()}`,
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || '',
                },
                done: false,
              };
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  private formatMessages(messages: Message[]): any[] {
    return messages.map(msg => {
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }

      // Handle structured content - convert to string for Ollama
      const textParts = msg.content
        .filter(part => part.type === 'text')
        .map(part => (part as any).text);

      const toolCallParts = msg.content
        .filter(part => part.type === 'tool_call')
        .map(part => `[Tool Call: ${(part as any).name}]`);

      const toolResultParts = msg.content
        .filter(part => part.type === 'tool_result')
        .map(part => `[Tool Result: ${(part as any).content}]`);

      const content = [...textParts, ...toolCallParts, ...toolResultParts].join('\n');

      return { role: msg.role, content };
    });
  }

  private formatTools(tools: ToolSchema[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.zodToJsonSchema(tool.parameters),
      },
    }));
  }

  private zodToJsonSchema(zodSchema: any): any {
    const def = zodSchema._def;
    if (!def) return {};

    if (def.typeName === 'ZodObject') {
      const properties: any = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(def.shape())) {
        properties[key] = this.zodToJsonSchema(value);
        if ((value as any)._def.typeName !== 'ZodOptional') {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      };
    }

    if (def.typeName === 'ZodString') {
      return { type: 'string', description: def.description };
    }

    if (def.typeName === 'ZodNumber') {
      return { type: 'number', description: def.description };
    }

    if (def.typeName === 'ZodBoolean') {
      return { type: 'boolean', description: def.description };
    }

    if (def.typeName === 'ZodArray') {
      return {
        type: 'array',
        items: this.zodToJsonSchema(def.type),
        description: def.description,
      };
    }

    if (def.typeName === 'ZodOptional') {
      return this.zodToJsonSchema(def.innerType);
    }

    if (def.typeName === 'ZodDefault') {
      return this.zodToJsonSchema(def.innerType());
    }

    return {};
  }

  private parseResponse(data: any): LLMResponse {
    const message = data.message;

    // Check for tool calls
    if (message?.tool_calls && message.tool_calls.length > 0) {
      return {
        content: message.content || '',
        stop_reason: 'tool_use',
        tool_calls: message.tool_calls.map((tc: any) => ({
          id: tc.id || `tool_${Date.now()}`,
          name: tc.function?.name || '',
          arguments: typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function?.arguments || {},
        })),
      };
    }

    // Regular response
    return {
      content: message?.content || '',
      stop_reason: data.done ? 'end_turn' : 'max_tokens',
    };
  }
}

/**
 * Helper to create Ollama provider
 */
export function createOllamaProvider(config: OllamaConfig): OllamaProvider {
  return new OllamaProvider(config);
}

/**
 * List available models
 */
export async function listOllamaModels(baseUrl: string = 'http://localhost:11434'): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/tags`);
  if (!response.ok) {
    throw new Error(`Failed to list models: ${await response.text()}`);
  }
  const data = await response.json() as { models?: Array<{ name: string }> };
  return data.models?.map((m) => m.name) || [];
}
