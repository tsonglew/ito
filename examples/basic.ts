/**
 * Ito - Basic Example
 * 展示如何使用 Ito 构建一个简单的 agent
 */

import { createHarness, createOpenAIProvider, tool, exampleTools } from '../src';
import { z } from 'zod';

async function main() {
  // 1. Create LLM provider
  const provider = createOpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
  });

  // 2. Create harness
  const harness = createHarness({
    provider,
    systemPrompt: `You are a helpful assistant with access to tools.
Use tools when appropriate to help the user.
Be concise and helpful.`,
    maxIterations: 5,
    onToolCall: (name, args) => {
      console.log(`[Tool Call] ${name}`, args);
    },
    onToolResult: (name, result) => {
      console.log(`[Tool Result] ${name}:`, result);
    },
  });

  // 3. Register tools
  // Use example tools
  harness.registerTool(exampleTools.echo);
  harness.registerTool(exampleTools.calculate);

  // Custom tool: Get current time
  harness.registerTool(
    tool('get_time')
      .setDescription('Get the current date and time')
      .setParameters(z.object({})) // No parameters needed
      .setHandler(async () => {
        const now = new Date();
        return `Current time: ${now.toISOString()}`;
      })
      .build()
  );

  // Custom tool: Search (mock)
  harness.registerTool(
    tool('search')
      .setDescription('Search the web for information')
      .setParameters(
        z.object({
          query: z.string().describe('Search query'),
        })
      )
      .setHandler(async (args) => {
        // In a real implementation, this would call a search API
        return `Mock search results for: "${args.query}"`;
      })
      .build()
  );

  // 4. Run the agent
  console.log('🧵 Starting Ito agent...\n');

  const userInput = process.argv[2] || "What time is it, and what's 25 * 4?";
  console.log(`User: ${userInput}\n`);

  try {
    const result = await harness.run(userInput);
    console.log('\nAssistant:', result);
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
