/**
 * OpenAI Completions Provider
 * Supports OpenAI-compatible APIs (OpenAI, Ollama, vLLM, LMStudio, etc.)
 */

import type { Message, ToolDefinition, AssistantMessage, ToolMessage } from '../../types';
import type { LLMProvider, SystemPromptBlock, ParsedStreamChunk } from './providers';

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

export class OpenAICompletionsProvider implements LLMProvider {
  formatRequest(
    messages: Message[],
    systemPrompt: string | SystemPromptBlock[] | undefined,
    options: {
      model: string;
      tools?: ToolDefinition[];
      modelParams?: Record<string, unknown>;
    }
  ): Record<string, unknown> {
    const openaiMessages = this.convertMessages(messages, systemPrompt);

    const body: Record<string, unknown> = {
      model: options.model,
      messages: openaiMessages,
      stream: true,
      ...options.modelParams,
    };

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      body.tools = this.convertTools(options.tools);
    }

    return body;
  }

  parseStreamChunk(chunk: string): ParsedStreamChunk | null {
    try {
      const parsed = JSON.parse(chunk);

      // Check for API error in stream
      if (parsed.error) {
        throw new Error(`OpenAI stream error: ${JSON.stringify(parsed.error)}`);
      }

      const choice = parsed.choices?.[0];
      const delta = choice?.delta;

      const result: ParsedStreamChunk = {};

      // Handle text content
      if (delta?.content) {
        result.content = delta.content;
      }

      // Handle tool calls (streamed incrementally)
      if (delta?.tool_calls) {
        result.toolCalls = delta.tool_calls.map((tc: any) => ({
          index: tc.index ?? 0,
          id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments,
        }));
      }

      // Track finish reason from API
      if (choice?.finish_reason) {
        result.finishReason = choice.finish_reason;
      }

      return result;
    } catch (e) {
      if (e instanceof SyntaxError) {
        // Skip malformed JSON
        console.warn('OpenAI: Skipping malformed JSON chunk:', chunk.substring(0, 100));
        return null;
      }
      // Re-throw actual errors
      throw e;
    }
  }

  getEndpoint(baseUrl: string): string {
    return `${baseUrl}/chat/completions`;
  }

  getHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private convertMessages(
    messages: Message[],
    systemPrompt: string | SystemPromptBlock[] | undefined
  ): OpenAIMessage[] {
    const openaiMessages: OpenAIMessage[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      const systemContent = typeof systemPrompt === 'string'
        ? systemPrompt
        : systemPrompt.map(block => block.text).join('\n');
      
      openaiMessages.push({
        role: 'system',
        content: systemContent,
      });
    }

    // Convert conversation messages
    for (const m of messages) {
      // Handle tool messages
      if (m.role === 'tool') {
        const toolMsg = m as ToolMessage;
        openaiMessages.push({
          role: 'tool',
          content: toolMsg.content,
          tool_call_id: toolMsg.toolCallId,
        });
        continue;
      }

      // Handle assistant messages with tool calls
      if (m.role === 'assistant') {
        const assistantMsg = m as AssistantMessage;
        if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
          openaiMessages.push({
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
          });
          continue;
        }
      }

      // Regular messages (system, user, assistant without tool calls)
      openaiMessages.push({
        role: m.role,
        content: m.content,
      });
    }

    return openaiMessages;
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
}
