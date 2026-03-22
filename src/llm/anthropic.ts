/**
 * Ito - Anthropic Claude Provider
 * Anthropic API 集成
 */

import { LLMProvider, LLMResponse, LLMStreamChunk, Message, ToolSchema } from '../types';

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private config: Required<Pick<AnthropicConfig, 'apiKey' | 'model' | 'baseUrl' | 'maxTokens' | 'temperature'>>;

  constructor(config: AnthropicConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || 'claude-3-5-sonnet-20241022',
      baseUrl: config.baseUrl || 'https://api.anthropic.com',
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
    };
  }

  async chat(messages: Message[], tools?: ToolSchema[]): Promise<LLMResponse> {
    // Extract system message
    const systemMessage = messages.find(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model,
        system: systemMessage ? (typeof systemMessage.content === 'string' ? systemMessage.content : this.extractText(systemMessage.content)) : undefined,
        messages: this.formatMessages(nonSystemMessages),
        tools: tools ? this.formatTools(tools) : undefined,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    const data = await response.json();
    return this.parseResponse(data);
  }

  async *stream(messages: Message[], tools?: ToolSchema[]): AsyncIterable<LLMStreamChunk> {
    const systemMessage = messages.find(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model,
        system: systemMessage ? (typeof systemMessage.content === 'string' ? systemMessage.content : this.extractText(systemMessage.content)) : undefined,
        messages: this.formatMessages(nonSystemMessages),
        tools: tools ? this.formatTools(tools) : undefined,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
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

            // Handle content_block_delta
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              yield { delta: parsed.delta.text, done: false };
            }

            // Handle tool use
            if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
              yield {
                tool_call: {
                  id: parsed.content_block.id,
                  name: parsed.content_block.name,
                  arguments: '',
                },
                done: false,
              };
            }

            // Handle tool input
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
              yield {
                tool_call: {
                  id: parsed.index?.toString() || '',
                  name: '',
                  arguments: parsed.delta.partial_json || '',
                },
                done: false,
              };
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
        return { role: msg.role === 'tool' ? 'user' : msg.role, content: msg.content };
      }

      // Handle structured content
      const content: any[] = [];

      for (const part of msg.content) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text });
        }
        if (part.type === 'tool_call') {
          content.push({
            type: 'tool_use',
            id: part.id,
            name: part.name,
            input: part.arguments,
          });
        }
        if (part.type === 'tool_result') {
          content.push({
            type: 'tool_result',
            tool_use_id: part.tool_call_id,
            content: part.content,
            is_error: part.is_error,
          });
        }
      }

      return {
        role: msg.role === 'tool' ? 'user' : msg.role,
        content,
      };
    });
  }

  private formatTools(tools: ToolSchema[]): any[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: this.zodToJsonSchema(tool.parameters),
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
    // Check for tool use
    const toolUseBlocks = data.content?.filter((block: any) => block.type === 'tool_use');

    if (toolUseBlocks && toolUseBlocks.length > 0) {
      return {
        content: data.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n'),
        stop_reason: 'tool_use',
        tool_calls: toolUseBlocks.map((block: any) => ({
          id: block.id,
          name: block.name,
          arguments: block.input,
        })),
        usage: data.usage ? {
          prompt_tokens: data.usage.input_tokens,
          completion_tokens: data.usage.output_tokens,
          total_tokens: data.usage.input_tokens + data.usage.output_tokens,
        } : undefined,
      };
    }

    // Regular response
    const textContent = data.content
      ?.filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n') || '';

    return {
      content: textContent,
      stop_reason: data.stop_reason === 'end_turn' ? 'end_turn' : data.stop_reason,
      usage: data.usage ? {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
      } : undefined,
    };
  }

  private extractText(content: any[]): string {
    return content
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('\n');
  }
}

/**
 * Helper to create Anthropic provider
 */
export function createAnthropicProvider(config: AnthropicConfig): AnthropicProvider {
  return new AnthropicProvider(config);
}
