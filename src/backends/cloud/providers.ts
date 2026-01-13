/**
 * LLM Provider Interface
 * Allows CloudLLM to support multiple API formats (OpenAI, Anthropic, etc.)
 */

import type { Message, ToolDefinition } from '../../types';

/**
 * System prompt block with optional cache control
 * Used by providers that support prompt caching (e.g., Anthropic)
 */
export interface SystemPromptBlock {
  text: string;
  cacheControl?: boolean;
}

/**
 * Parsed chunk from streaming response
 */
export interface ParsedStreamChunk {
  content?: string;
  toolCalls?: Array<{
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  }>;
  finishReason?: string;
  done?: boolean;
}

/**
 * LLMProvider interface
 * Providers implement API-specific request/response formatting
 */
export interface LLMProvider {
  /**
   * Format the request body for the provider's API
   * @param messages - Conversation messages
   * @param systemPrompt - System prompt (simple string or structured blocks)
   * @param options - Request options (model, tools, params, etc.)
   */
  formatRequest(
    messages: Message[],
    systemPrompt: string | SystemPromptBlock[] | undefined,
    options: {
      model: string;
      tools?: ToolDefinition[];
      modelParams?: Record<string, unknown>;
    }
  ): Record<string, unknown>;

  /**
   * Parse a streaming chunk from the provider's API
   * @param chunk - Raw chunk data (SSE line without "data: " prefix)
   * @returns Parsed chunk with content, tool calls, and done status
   */
  parseStreamChunk(chunk: string): ParsedStreamChunk | null;

  /**
   * Get the full API endpoint URL
   * @param baseUrl - Base URL (e.g., "https://api.openai.com/v1")
   * @returns Full endpoint URL
   */
  getEndpoint(baseUrl: string): string;

  /**
   * Get request headers
   * @param apiKey - API key (optional)
   * @returns Headers object
   */
  getHeaders(apiKey?: string): Record<string, string>;
}
