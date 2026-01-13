/**
 * Anthropic Messages Provider
 * Supports Anthropic Claude API with prompt caching
 */

import type { Message, ToolDefinition, AssistantMessage, ToolMessage } from '../../types';
import type { LLMProvider, SystemPromptBlock, ParsedStreamChunk } from './providers';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: ToolDefinition['parameters'];
}

export class AnthropicMessagesProvider implements LLMProvider {
  formatRequest(
    messages: Message[],
    systemPrompt: string | SystemPromptBlock[] | undefined,
    options: {
      model: string;
      tools?: ToolDefinition[];
      modelParams?: Record<string, unknown>;
    }
  ): Record<string, unknown> {
    const anthropicMessages = this.convertMessages(messages);

    const body: Record<string, unknown> = {
      model: options.model,
      messages: anthropicMessages,
      stream: true,
      max_tokens: 4096, // Anthropic requires max_tokens
      ...options.modelParams,
    };

    // Add system prompt if provided
    if (systemPrompt) {
      if (typeof systemPrompt === 'string') {
        body.system = systemPrompt;
      } else {
        // Structured system prompt with cache control
        body.system = systemPrompt.map(block => {
          const systemBlock: AnthropicSystemBlock = {
            type: 'text',
            text: block.text,
          };
          if (block.cacheControl) {
            systemBlock.cache_control = { type: 'ephemeral' };
          }
          return systemBlock;
        });
      }
    }

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      body.tools = this.convertTools(options.tools);
    }

    return body;
  }

  parseStreamChunk(chunk: string): ParsedStreamChunk | null {
    try {
      const parsed = JSON.parse(chunk);

      // Check for API error
      if (parsed.error) {
        throw new Error(`Anthropic stream error: ${JSON.stringify(parsed.error)}`);
      }

      const result: ParsedStreamChunk = {};

      // Anthropic streaming event types:
      // - message_start: Contains message metadata
      // - content_block_start: New content block started
      // - content_block_delta: Incremental content
      // - content_block_stop: Content block finished
      // - message_delta: Message metadata updates (e.g., stop_reason)
      // - message_stop: Stream complete

      if (parsed.type === 'content_block_delta') {
        const delta = parsed.delta;
        
        // Text delta
        if (delta.type === 'text_delta') {
          result.content = delta.text;
        }
        
        // Tool use delta (input JSON being streamed)
        if (delta.type === 'input_json_delta') {
          result.toolCalls = [{
            index: parsed.index ?? 0,
            arguments: delta.partial_json,
          }];
        }
      } else if (parsed.type === 'content_block_start') {
        const content = parsed.content_block;
        
        // Tool use started
        if (content.type === 'tool_use') {
          result.toolCalls = [{
            index: parsed.index ?? 0,
            id: content.id,
            name: content.name,
            arguments: '', // Will be streamed via input_json_delta
          }];
        }
      } else if (parsed.type === 'message_delta') {
        // Contains stop_reason and usage info
        if (parsed.delta.stop_reason) {
          result.finishReason = parsed.delta.stop_reason;
        }
      } else if (parsed.type === 'message_stop') {
        result.done = true;
      }

      return result;
    } catch (e) {
      if (e instanceof SyntaxError) {
        // Skip malformed JSON
        console.warn('Anthropic: Skipping malformed JSON chunk:', chunk.substring(0, 100));
        return null;
      }
      // Re-throw actual errors
      throw e;
    }
  }

  getEndpoint(baseUrl: string): string {
    return `${baseUrl}/messages`;
  }

  getHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    return headers;
  }

  private convertMessages(messages: Message[]): AnthropicMessage[] {
    const anthropicMessages: AnthropicMessage[] = [];

    for (const m of messages) {
      // Skip system messages (handled separately in formatRequest)
      if (m.role === 'system') {
        continue;
      }

      // Handle tool messages
      if (m.role === 'tool') {
        const toolMsg = m as ToolMessage;
        // Anthropic requires tool results to be in user messages
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        const toolResultBlock: AnthropicContentBlock = {
          type: 'tool_result',
          tool_use_id: toolMsg.toolCallId,
          content: toolMsg.content,
        };

        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          // Append to existing user message
          lastMsg.content.push(toolResultBlock);
        } else {
          // Create new user message
          anthropicMessages.push({
            role: 'user',
            content: [toolResultBlock],
          });
        }
        continue;
      }

      // Handle assistant messages with tool calls
      if (m.role === 'assistant') {
        const assistantMsg = m as AssistantMessage;
        if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
          const content: AnthropicContentBlock[] = [];
          
          // Add text content if present
          if (assistantMsg.content) {
            content.push({
              type: 'text',
              text: assistantMsg.content,
            });
          }
          
          // Add tool use blocks
          for (const tc of assistantMsg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          
          anthropicMessages.push({
            role: 'assistant',
            content,
          });
          continue;
        }
      }

      // Regular messages (user, assistant without tool calls)
      anthropicMessages.push({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      });
    }

    return anthropicMessages;
  }

  private convertTools(tools: ToolDefinition[]): AnthropicTool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
}
