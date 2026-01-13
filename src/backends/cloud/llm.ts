/**
 * Cloud LLM Pipeline (Multi-provider support)
 * Works with: OpenAI, Anthropic, Ollama, vLLM, LMStudio, and any compatible endpoint
 *
 * Uses native fetch with streaming - no external dependencies required.
 * Supports native tool calling via provider-specific APIs.
 */

import type {
  LLMPipeline,
  CloudLLMConfig,
  ProgressCallback,
  Message,
  LLMGenerateOptions,
  LLMGenerateResult,
  ToolCall,
} from '../../types';
import { LLMLogger, LLMConversationTracker, type TrackerMessage } from '../../services';
import type { LLMProvider } from './providers';
import { OpenAICompletionsProvider } from './openai-provider';

export class CloudLLM implements LLMPipeline {
  private config: CloudLLMConfig;
  private provider: LLMProvider;
  private ready = false;
  private tracker: LLMConversationTracker;

  constructor(config: CloudLLMConfig, provider?: LLMProvider) {
    this.config = config;
    this.provider = provider || new OpenAICompletionsProvider();
    this.tracker = new LLMConversationTracker(new LLMLogger());
  }

  async initialize(_onProgress?: ProgressCallback): Promise<void> {
    console.log(`Initializing Cloud LLM (${this.config.baseUrl})...`);
    console.log(`  Model: ${this.config.model}`);

    // Validate the endpoint is reachable (optional health check)
    try {
      const modelsUrl = `${this.config.baseUrl}/models`;
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: this.provider.getHeaders(this.config.apiKey),
      });

      if (!response.ok) {
        // Some endpoints don't have /models, that's okay
        console.log('  Note: /models endpoint not available (this is fine for some providers)');
      } else {
        console.log('  API endpoint verified.');
      }
    } catch {
      // Connection errors are fine during init - we'll fail at generate time if needed
      console.log('  Note: Could not verify API endpoint (will retry on first request)');
    }

    this.ready = true;
    console.log('Cloud LLM ready.');
  }

  supportsTools(): boolean {
    return true;
  }

  async generate(messages: Message[], options?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    if (!this.ready) {
      throw new Error('LLM pipeline not initialized');
    }

    // Log the input messages
    this.tracker.logInput(messages as TrackerMessage[]);

    // Get endpoint from provider
    const url = this.provider.getEndpoint(this.config.baseUrl);

    // Extract system prompt from messages
    const systemPrompt = this.extractSystemPrompt(messages);
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Format request using provider
    const body = this.provider.formatRequest(
      conversationMessages,
      systemPrompt,
      {
        model: this.config.model,
        tools: options?.tools,
        modelParams: this.config.modelParams,
      }
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: this.provider.getHeaders(this.config.apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloud LLM API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body received');
    }

    // Parse SSE stream using provider
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let finishReason: string | null = null;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed || trimmed === 'data: [DONE]') {
          continue;
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);

          try {
            const parsed = this.provider.parseStreamChunk(jsonStr);

            if (!parsed) {
              continue; // Skip null results (malformed JSON, etc.)
            }

            // Handle text content
            if (parsed.content) {
              fullContent += parsed.content;
              options?.onToken?.(parsed.content);
            }

            // Handle tool calls (streamed incrementally)
            if (parsed.toolCalls) {
              for (const tc of parsed.toolCalls) {
                const index = tc.index ?? 0;

                if (!toolCalls.has(index)) {
                  toolCalls.set(index, { id: '', name: '', arguments: '' });
                }

                const existing = toolCalls.get(index)!;

                if (tc.id) {
                  existing.id = tc.id;
                }
                if (tc.name) {
                  existing.name = tc.name;
                }
                if (tc.arguments) {
                  existing.arguments += tc.arguments;
                }
              }
            }

            // Track finish reason from API
            if (parsed.finishReason) {
              finishReason = parsed.finishReason;
            }
          } catch (e) {
            // Errors during parsing are already handled by provider
            throw e;
          }
        }
      }
    }

    // Convert collected tool calls to our format
    const resultToolCalls: ToolCall[] = [];
    for (const [, tc] of toolCalls) {
      if (tc.id && tc.name) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.arguments || '{}');
        } catch {
          // Use empty args if parsing fails
        }

        const toolCall: ToolCall = {
          id: tc.id,
          name: tc.name,
          arguments: args,
        };
        resultToolCalls.push(toolCall);
        options?.onToolCall?.(toolCall);
      }
    }

    // Check for empty response (no content and no tool calls)
    if (!fullContent && resultToolCalls.length === 0) {
      const reason = finishReason || 'unknown';
      throw new Error(
        `Cloud LLM returned empty response (finish_reason: ${reason}). ` +
        (reason === 'length'
          ? 'The model hit the token limit before producing output. Try increasing max_completion_tokens.'
          : 'The model did not produce any content.')
      );
    }

    // Log the response
    this.tracker.logOutput(
      fullContent,
      resultToolCalls.length > 0 ? resultToolCalls : undefined
    );

    // Normalize finish reason for our interface
    const normalizedFinishReason: 'stop' | 'tool_calls' =
      resultToolCalls.length > 0 ? 'tool_calls' : 'stop';

    return {
      content: fullContent,
      toolCalls: resultToolCalls.length > 0 ? resultToolCalls : undefined,
      finishReason: normalizedFinishReason,
    };
  }

  private extractSystemPrompt(messages: Message[]): string | undefined {
    // Use structuredSystemPrompt if provided in config
    if (this.config.structuredSystemPrompt) {
      return this.config.structuredSystemPrompt as any; // Will be passed to provider as-is
    }

    // Otherwise, extract from messages
    const systemMsg = messages.find(m => m.role === 'system');
    return systemMsg?.content;
  }

  isReady(): boolean {
    return this.ready;
  }
}
