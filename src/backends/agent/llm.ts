/**
 * Agent LLM Pipeline
 * Wraps agent SDKs (OpenCode, Pi Agent, etc.) as an LLMPipeline backend.
 *
 * Unlike CloudLLM which makes raw API calls and lets the voice pipeline handle
 * tool execution, AgentLLM delegates to an agent SDK that manages its own
 * tool execution loop internally. From the voice pipeline's perspective,
 * this backend always returns finishReason: 'stop' — the tool loop is
 * handled entirely within the agent.
 *
 * Tool activity events are forwarded via onToolCall callbacks so the UI
 * can display "Reading file...", "Writing code...", etc.
 */

import type {
  LLMPipeline,
  ProgressCallback,
  Message,
  LLMGenerateOptions,
  LLMGenerateResult,
} from '../../types';
import type { AgentProvider, AgentSession } from './provider';

export class AgentLLM implements LLMPipeline {
  private provider: AgentProvider;
  private session: AgentSession | null = null;
  private ready = false;

  constructor(provider: AgentProvider) {
    this.provider = provider;
  }

  async initialize(_onProgress?: ProgressCallback): Promise<void> {
    console.log('Initializing Agent LLM...');
    this.ready = true;
    console.log('Agent LLM ready (session will be created on first message).');
  }

  /**
   * Agent backends handle tools internally — the voice pipeline
   * should not pass tool definitions or expect tool_calls back.
   */
  supportsTools(): boolean {
    return false;
  }

  async generate(messages: Message[], options?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    if (!this.ready) {
      throw new Error('Agent LLM pipeline not initialized');
    }

    // Lazily create the agent session on first generate() call
    if (!this.session) {
      console.log('Creating agent session...');
      this.session = await this.provider.createSession();
      console.log('Agent session created.');
    }

    // Extract the latest user message from the conversation history.
    // The agent SDK maintains its own history, so we only need the new message.
    const latestUserMessage = this.extractLatestUserMessage(messages);
    if (!latestUserMessage) {
      return { content: '', finishReason: 'stop' };
    }

    // Stream the response from the agent
    let fullContent = '';

    for await (const event of this.session.sendMessage(latestUserMessage)) {
      switch (event.type) {
        case 'text_delta':
          if (event.content) {
            fullContent += event.content;
            options?.onToken?.(event.content);
          }
          break;

        case 'tool_call_start':
          if (event.toolCall) {
            options?.onToolCall?.({
              id: event.toolCall.id,
              name: event.toolCall.name,
              arguments: event.toolCall.arguments ?? {},
            });
          }
          break;

        case 'tool_call_end':
          // Tool results are informational only — the agent already handled them.
          break;

        case 'error':
          throw new Error(`Agent error: ${event.error ?? 'Unknown error'}`);

        case 'done':
          break;
      }
    }

    // Always return 'stop' — the agent handles its own tool loop.
    // The voice pipeline's tool loop will exit on the first iteration.
    return {
      content: fullContent,
      finishReason: 'stop',
    };
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Destroy the current session and release resources.
   * A new session will be created on the next generate() call.
   */
  async destroySession(): Promise<void> {
    if (this.session) {
      await this.session.destroy();
      this.session = null;
    }
  }

  /**
   * Extract the latest user message from the conversation history.
   * We walk backwards to find the most recent 'user' role message.
   */
  private extractLatestUserMessage(messages: Message[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i].content;
      }
    }
    return null;
  }
}
