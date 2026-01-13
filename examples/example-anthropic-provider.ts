/**
 * Example: CloudLLM with Anthropic Provider
 * 
 * Demonstrates using the AnthropicMessagesProvider with prompt caching
 */

import { 
  CloudLLM, 
  AnthropicMessagesProvider 
} from '../../src/backends/cloud';

async function main() {
  // Example 1: OpenAI-compatible (default)
  const openaiLLM = new CloudLLM({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4',
  });

  // Example 2: Anthropic with simple system prompt
  const anthropicLLM = new CloudLLM(
    {
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
    },
    new AnthropicMessagesProvider()
  );

  // Example 3: Anthropic with structured system prompt and cache control
  const anthropicWithCache = new CloudLLM(
    {
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
      structuredSystemPrompt: [
        { 
          text: 'You are a helpful AI assistant specialized in code review.' 
        },
        { 
          text: `Here is the codebase context:\n\n${getLargeCodebase()}`,
          cacheControl: true, // This block will be cached by Anthropic
        },
      ],
    },
    new AnthropicMessagesProvider()
  );

  await anthropicWithCache.initialize();

  // Generate response
  const result = await anthropicWithCache.generate([
    { role: 'user', content: 'Review this function for bugs.' },
  ], {
    onToken: (token) => process.stdout.write(token),
  });

  console.log('\n\nFinish reason:', result.finishReason);
}

function getLargeCodebase(): string {
  // In a real scenario, this would be your large codebase or context
  return '// ... large codebase content ...';
}

main().catch(console.error);
