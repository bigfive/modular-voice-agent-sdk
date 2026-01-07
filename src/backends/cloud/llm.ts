/**
 * Cloud LLM Pipeline (OpenAI-compatible API)
 * Works with: OpenAI, Ollama, vLLM, LMStudio, and any OpenAI-compatible endpoint
 *
 * Uses native fetch with streaming - no external dependencies required.
 * Supports native tool calling via the OpenAI function calling API.
 */

import type {
  LLMPipeline,
  CloudLLMConfig,
  ProgressCallback,
  Message,
  LLMGenerateOptions,
  LLMGenerateResult,
  ToolDefinition,
  ToolCall,
  ToolMessage,
  AssistantMessage,
} from '../../types';
import { LLMLogger, LLMConversationTracker, type TrackerMessage } from '../../services';

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolDefinition['parameters'];
  };
}

export class CloudLLM implements LLMPipeline {
  private config: CloudLLMConfig;
  private ready = false;
  private tracker: LLMConversationTracker;

  constructor(config: CloudLLMConfig) {
    this.config = config;
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
        headers: this.getHeaders(),
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

    // Use conversation ID if provided, else default
    const conversationId = options?.conversationId ?? 'default';

    // Log the input messages
    this.tracker.logInput(conversationId, messages as TrackerMessage[]);

    const url = `${this.config.baseUrl}/chat/completions`;

    // Convert messages to OpenAI format
    const openaiMessages = this.convertMessages(messages);

    // Build request body
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: openaiMessages,
      stream: true,
      ...this.config.modelParams,
    };

    // Add tools if provided
    if (options?.tools && options.tools.length > 0) {
      body.tools = this.convertTools(options.tools);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloud LLM API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body received');
    }

    // Parse SSE stream
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
            const parsed = JSON.parse(jsonStr);

            // Check for API error in stream
            if (parsed.error) {
              throw new Error(`Cloud LLM stream error: ${JSON.stringify(parsed.error)}`);
            }

            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            // Handle text content
            if (delta?.content) {
              fullContent += delta.content;
              options?.onToken?.(delta.content);
            }

            // Handle tool calls (streamed incrementally)
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;

                if (!toolCalls.has(index)) {
                  toolCalls.set(index, { id: '', name: '', arguments: '' });
                }

                const existing = toolCalls.get(index)!;

                if (tc.id) {
                  existing.id = tc.id;
                }
                if (tc.function?.name) {
                  existing.name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments;
                }
              }
            }

            // Track finish reason from API
            if (choice?.finish_reason) {
              finishReason = choice.finish_reason;
            }
          } catch (e) {
            // Re-throw actual errors, only skip JSON parse errors
            if (e instanceof SyntaxError) {
              console.warn('CloudLLM: Skipping malformed JSON line:', jsonStr.substring(0, 100));
            } else {
              throw e;
            }
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
      conversationId,
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

  private convertMessages(messages: Message[]): OpenAIMessage[] {
    return messages.map((m) => {
      // Handle tool messages
      if (m.role === 'tool') {
        const toolMsg = m as ToolMessage;
        return {
          role: 'tool',
          content: toolMsg.content,
          tool_call_id: toolMsg.toolCallId,
        };
      }

      // Handle assistant messages with tool calls
      if (m.role === 'assistant') {
        const assistantMsg = m as AssistantMessage;
        if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
          return {
            role: 'assistant',
            content: assistantMsg.content || null,
            tool_calls: assistantMsg.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          };
        }
      }

      // Regular messages
      return {
        role: m.role,
        content: m.content,
      };
    });
  }

  private convertTools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  isReady(): boolean {
    return this.ready;
  }
}

