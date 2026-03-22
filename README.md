# ito

**糸** (ito) — A minimal agent harness framework

编织智能的 TypeScript 框架。

## 特性

- 🧵 **极简核心** — 核心循环不到 200 行
- 📦 **类型安全** — 完整的 TypeScript 类型 + Zod 验证
- 🔌 **可扩展** — 支持任意 LLM provider
- 🛠️ **工具系统** — 流式 API 定义工具
- 💬 **消息管理** — 结构化消息格式
- ⚡ **零依赖** — 只需要 Zod

## 快速开始

```bash
npm install ito
```

```typescript
import { createHarness, createOpenAIProvider, tool } from 'ito';
import { z } from 'zod';

// 1. 创建 provider
const provider = createOpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
});

// 2. 创建 harness
const harness = createHarness({
  provider,
  systemPrompt: 'You are a helpful assistant.',
});

// 3. 注册工具
harness.registerTool(
  tool('get_weather')
    .setDescription('Get weather for a location')
    .setParameters(
      z.object({
        location: z.string().describe('City name'),
      })
    )
    .setHandler(async (args) => {
      // Your implementation
      return `Weather in ${args.location}: Sunny, 72°F`;
    })
    .build()
);

// 4. 运行
const result = await harness.run("What's the weather in Tokyo?");
console.log(result);
```

## 核心概念

### Harness

核心控制器，管理 agent 的完整生命周期：

```typescript
const harness = createHarness({
  provider: llmProvider,          // LLM provider
  systemPrompt: '...',            // 系统提示
  maxIterations: 10,              // 最大循环次数
  maxTokens: 4096,                // 最大 token 数
  onToolCall: (name, args) => {}, // 工具调用回调
  onToolResult: (name, result) => {}, // 工具结果回调
  onMessage: (msg) => {},         // 消息回调
  onError: (err) => {},           // 错误回调
});
```

### Tool

工具是 agent 的能力扩展：

```typescript
const myTool = tool('tool_name')
  .setDescription('What this tool does')
  .setParameters(
    z.object({
      param1: z.string().describe('Description'),
      param2: z.number().optional(),
    })
  )
  .setHandler(async (args, context) => {
    // context.harness - 访问 harness
    // context.message - 触发工具的消息

    return 'Tool result';
  })
  .build();

harness.registerTool(myTool);
```

### LLM Provider

连接不同的 LLM：

```typescript
// OpenAI
import { createOpenAIProvider } from 'ito';

const provider = createOpenAIProvider({
  apiKey: 'sk-...',
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com', // 可选
  temperature: 0.7,
});
```

自定义 provider：

```typescript
const myProvider: LLMProvider = {
  name: 'custom',
  async chat(messages, tools) {
    // 调用你的 LLM API
    return {
      content: 'Response text',
      stop_reason: 'end_turn', // or 'tool_use'
      tool_calls: [            // 如果 stop_reason === 'tool_use'
        {
          id: 'call_123',
          name: 'tool_name',
          arguments: { ... }
        }
      ]
    };
  }
};
```

## 架构

```
┌─────────────────────────────────────────────┐
│                  Harness                     │
│  ┌────────────────────────────────────────┐ │
│  │  Message Queue (state.messages)        │ │
│  └────────────────────────────────────────┘ │
│                   │                          │
│                   ▼                          │
│  ┌────────────────────────────────────────┐ │
│  │         LLM Provider                   │ │
│  │  - chat(messages, tools) → response    │ │
│  └────────────────────────────────────────┘ │
│                   │                          │
│                   ▼                          │
│  ┌────────────────────────────────────────┐ │
│  │      Response Handler                  │ │
│  │  - end_turn → return result            │ │
│  │  - tool_use → execute tools            │ │
│  └────────────────────────────────────────┘ │
│                   │                          │
│                   ▼                          │
│  ┌────────────────────────────────────────┐ │
│  │         Tool Registry                  │ │
│  │  - tools.get(name) → ToolDefinition    │ │
│  │  - handler(args) → result              │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## 核心循环

```
用户输入 → [消息队列] → LLM 推理
                              │
                              ▼
                        stop_reason?
                         /        \
                    end_turn    tool_use
                        │           │
                        ▼           ▼
                     返回结果    执行工具
                                    │
                                    ▼
                                工具结果 → [消息队列] → LLM 推理
                                                                │
                                                                ▼
                                                           (循环继续)
```

## 进阶用法

### 消息历史管理

```typescript
// 访问消息历史
const messages = harness.state.messages;

// 重置状态
harness.reset();

// 继续对话
const result = await harness.run('Follow-up question');
```

### 工具上下文

```typescript
.setHandler(async (args, context) => {
  // 访问 harness
  const messages = context.harness.state.messages;

  // 访问触发消息
  const triggerMessage = context.message;

  // 返回结果
  return 'Result';
})
```

### 错误处理

```typescript
const harness = createHarness({
  provider,
  onError: (error) => {
    console.error('Harness error:', error);
  },
});

try {
  const result = await harness.run('...');
} catch (error) {
  // 处理错误
}
```

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 运行示例
npm run example

# 测试
npm test
```

## 灵感来源

名字 **ito** (糸) 来自日语，意为"线"。

就像线编织成布，工具调用和消息编织成智能行为。

## License

MIT
