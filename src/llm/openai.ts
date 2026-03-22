/**
 * Ito - OpenAI Provider
 * OpenAI API 集成
 */

import { LLMProvider, LLMResponse, LLMStreamChunk, Message, ToolSchema } from '../types';

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private config: Required<Pick<OpenAIConfig, 'apiKey' | 'model' | 'baseUrl' | 'temperature' | 'maxTokens'>>;

  constructor(config: OpenAIConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || 'gpt-4o-mini',
      baseUrl: config.baseUrl || 'https://api.openai.com',
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens || 4096,
    };
  }

  async chat(messages: Message[], tools?: ToolSchema[]): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: this.formatMessages(messages),
        tools: tools ? this.formatTools(tools) : undefined,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    return this.parseResponse(data);
  }

  async *stream(messages: Message[], tools?: ToolSchema[]): AsyncIterable<LLMStreamChunk> {
    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: this.formatMessages(messages),
        tools: tools ? this.formatTools(tools) : undefined,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
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
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            if (delta?.content) {
              yield { delta: delta.content, done: false };
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                yield {
                  tool_call: {
                    id: tc.id,
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
  }

  private formatMessages(messages: Message[]): any[] {
    return messages.map(msg => {
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }

      // Handle structured content
      const content = msg.content.map(part => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        }
        if (part.type === 'tool_call') {
          return {
            type: 'tool_use',
            id: part.id,
            name: part.name,
            input: part.arguments,
          };
        }
        if (part.type === 'tool_result') {
          return {
            type: 'tool_result',
            tool_use_id: part.tool_call_id,
            content: part.content,
          };
        }
        return part;
      });

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
    // Simple conversion - in production, use a proper Zod-to-JSON-Schema converter
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
    const choice = data.choices[0];
    const message = choice.message;

    // Check for tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      return {
        content: message.content || '',
        stop_reason: 'tool_use',
        tool_calls: message.tool_calls.map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })),
        usage: data.usage,
      };
    }

    // Regular response
    return {
      content: message.content || '',
      stop_reason: choice.finish_reason === 'stop' ? 'end_turn' : choice.finish_reason,
      usage: data.usage,
    };
  }
}

/**
 * Helper to create OpenAI provider
 */
export function createOpenAIProvider(config: OpenAIConfig): OpenAIProvider {
  return new OpenAIProvider(config);
}
