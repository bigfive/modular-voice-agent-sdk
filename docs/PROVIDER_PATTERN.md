# CloudLLM Provider Pattern

The CloudLLM now supports multiple API formats through a provider pattern.

## Usage

### Default (OpenAI-compatible)

```typescript
import { CloudLLM } from 'voice-pipeline';

const llm = new CloudLLM({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-...',
  model: 'gpt-4',
});
```

### Anthropic Messages API

```typescript
import { CloudLLM, AnthropicMessagesProvider } from 'voice-pipeline';

const llm = new CloudLLM(
  {
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-...',
    model: 'claude-3-5-sonnet-20241022',
  },
  new AnthropicMessagesProvider()
);
```

### With Structured System Prompt (Anthropic Cache Control)

```typescript
import { CloudLLM, AnthropicMessagesProvider } from 'voice-pipeline';

const llm = new CloudLLM(
  {
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-...',
    model: 'claude-3-5-sonnet-20241022',
    structuredSystemPrompt: [
      { text: 'You are a helpful assistant.' },
      { text: 'Long context here...', cacheControl: true }, // Cache this block
    ],
  },
  new AnthropicMessagesProvider()
);
```

## Creating Custom Providers

Implement the `LLMProvider` interface:

```typescript
import type { LLMProvider, SystemPromptBlock, ParsedStreamChunk } from 'voice-pipeline';

class CustomProvider implements LLMProvider {
  formatRequest(messages, systemPrompt, options) {
    // Convert to your API's format
    return { /* request body */ };
  }

  parseStreamChunk(chunk: string): ParsedStreamChunk | null {
    // Parse streaming response
    return {
      content?: string,
      toolCalls?: Array<{ index, id?, name?, arguments? }>,
      finishReason?: string,
      done?: boolean,
    };
  }

  getEndpoint(baseUrl: string): string {
    return `${baseUrl}/your/endpoint`;
  }

  getHeaders(apiKey?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
  }
}
```

## Exports

From `voice-pipeline/backends/cloud`:
- `CloudLLM` - Main LLM class
- `OpenAICompletionsProvider` - OpenAI-compatible provider (default)
- `AnthropicMessagesProvider` - Anthropic Claude provider
- `LLMProvider` - Interface for custom providers
- `SystemPromptBlock` - Type for structured system prompts
- `ParsedStreamChunk` - Type for parsed streaming chunks
