/**
 * Pi Agent Provider
 * Wraps a Pi Agent instance (@mariozechner/pi-agent-core) as an AgentProvider.
 *
 * The user creates the Agent externally with their own model, tools, and config.
 * This provider wraps it and maps its event stream to AgentStreamEvents.
 *
 * @example
 * ```typescript
 * import { Agent } from '@mariozechner/pi-agent-core';
 * import { getModel } from '@mariozechner/pi-ai';
 * import { codingTools } from '@mariozechner/pi-coding-agent';
 *
 * const agent = new Agent({
 *   initialState: {
 *     systemPrompt: 'You are a coding assistant.',
 *     model: getModel('anthropic', 'claude-sonnet-4-20250514'),
 *     thinkingLevel: 'medium',
 *     tools: codingTools,
 *   },
 * });
 *
 * const pipeline = createVoicePipeline({
 *   create: () => ({
 *     stt: new CloudSTT({ ... }),
 *     llm: new AgentLLM(new PiAgentProvider({ agent })),
 *     tts: null,
 *     systemPrompt: 'You are a coding assistant.',
 *   }),
 * });
 * ```
 */

import type { AgentProvider, AgentSession, AgentStreamEvent } from './provider';

/**
 * Configuration for the Pi Agent provider.
 */
export interface PiAgentProviderConfig {
  /**
   * A pre-created Pi Agent instance.
   * Created externally with your own model, tools, and configuration.
   */
  agent: PiAgent;
}

/**
 * Pi Agent Provider
 * Wraps an externally-created Pi Agent instance.
 */
export class PiAgentProvider implements AgentProvider {
  private agent: PiAgent;

  constructor(config: PiAgentProviderConfig) {
    this.agent = config.agent;
  }

  async createSession(): Promise<AgentSession> {
    return new PiAgentSession(this.agent);
  }
}

/**
 * Active Pi Agent session.
 * Wraps a Pi Agent instance and maps its event stream to AgentStreamEvents.
 */
class PiAgentSession implements AgentSession {
  private agent: PiAgent;

  constructor(agent: PiAgent) {
    this.agent = agent;
  }

  async *sendMessage(text: string): AsyncIterable<AgentStreamEvent> {
    // Use a queue to bridge the callback-based event system to an async iterable.
    // The agent emits events via subscribe(), and we yield them from the generator.
    const eventQueue: AgentStreamEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const waitForEvent = (): Promise<void> =>
      new Promise<void>((r) => {
        if (eventQueue.length > 0) {
          r();
        } else {
          resolve = r;
        }
      });

    const pushEvent = (event: AgentStreamEvent): void => {
      eventQueue.push(event);
      if (resolve) {
        const r = resolve;
        resolve = null;
        r();
      }
    };

    // Subscribe to agent events
    const unsubscribe = this.agent.subscribe((event: PiAgentEvent) => {
      const eventType: string = event.type;

      if (eventType === 'message_update') {
        // Streaming text delta from assistant
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent?.type === 'text_delta' && assistantEvent.delta) {
          pushEvent({
            type: 'text_delta',
            content: assistantEvent.delta,
          });
        }
      } else if (eventType === 'tool_execution_start') {
        pushEvent({
          type: 'tool_call_start',
          toolCall: {
            id: event.toolCallId ?? '',
            name: event.toolName ?? 'unknown',
            arguments: event.args ?? {},
          },
        });
      } else if (eventType === 'tool_execution_end') {
        pushEvent({
          type: 'tool_call_end',
          toolCall: {
            id: event.toolCallId ?? '',
            name: event.toolName ?? 'unknown',
            result: event.result,
            isError: event.isError,
          },
        });
      } else if (eventType === 'agent_end') {
        pushEvent({ type: 'done' });
        done = true;
      }
    });

    try {
      // Start the agent prompt (runs asynchronously, events come via subscribe)
      const promptPromise = this.agent.prompt(text).catch((err: Error) => {
        pushEvent({
          type: 'error',
          error: err.message ?? 'Pi Agent error',
        });
        done = true;
      });

      // Yield events as they arrive
      while (!done) {
        await waitForEvent();
        while (eventQueue.length > 0) {
          const event = eventQueue.shift()!;
          yield event;
          if (event.type === 'done' || event.type === 'error') {
            done = true;
            break;
          }
        }
      }

      // Wait for prompt to fully complete
      await promptPromise;
    } finally {
      unsubscribe();
    }
  }

  async destroy(): Promise<void> {
    this.agent.abort();
  }
}

/**
 * Minimal type definitions for the Pi Agent SDK.
 * These match the SDK's API surface without requiring the SDK at build time.
 * The user passes in the real Agent instance which satisfies this interface.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
interface PiAgentEvent {
  type: string;
  // message_update
  assistantMessageEvent?: {
    type: string;
    delta?: string;
  };
  // tool_execution_start / tool_execution_end
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: any;
  isError?: boolean;
}

export interface PiAgent {
  prompt(text: string | any, images?: any[]): Promise<void>;
  subscribe(listener: (event: PiAgentEvent) => void): () => void;
  abort(): void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
