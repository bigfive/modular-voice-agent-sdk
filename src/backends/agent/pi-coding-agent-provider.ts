/**
 * Pi Coding Agent Provider
 * Wraps a Pi Coding Agent session (@mariozechner/pi-coding-agent) as an AgentProvider.
 *
 * This is the higher-level wrapper compared to PiAgentProvider. The Pi Coding Agent
 * adds session management, auto-compaction, retries, skill expansion, prompt templates,
 * and built-in coding tools (read, write, edit, bash, grep, find, ls) on top of the
 * raw Pi Agent runtime.
 *
 * The user creates the session externally via createAgentSession() and passes it in.
 *
 * @example
 * ```typescript
 * import {
 *   createAgentSession,
 *   SessionManager,
 *   AuthStorage,
 *   ModelRegistry,
 * } from '@mariozechner/pi-coding-agent';
 *
 * const authStorage = new AuthStorage();
 * const { session } = await createAgentSession({
 *   sessionManager: SessionManager.inMemory(),
 *   authStorage,
 *   modelRegistry: new ModelRegistry(authStorage),
 * });
 *
 * const pipeline = createVoicePipeline({
 *   create: () => ({
 *     stt: new CloudSTT({ ... }),
 *     llm: new AgentLLM(new PiCodingAgentProvider({ session })),
 *     tts: null,
 *     systemPrompt: 'You are a coding assistant.',
 *   }),
 * });
 * ```
 */

import type { AgentProvider, AgentSession as VoiceAgentSession, AgentStreamEvent } from './provider';

/**
 * Configuration for the Pi Coding Agent provider.
 */
export interface PiCodingAgentProviderConfig {
  /**
   * A pre-created Pi Coding Agent session.
   * Created externally via createAgentSession() from @mariozechner/pi-coding-agent.
   */
  session: PiCodingAgentSession;
}

/**
 * Pi Coding Agent Provider
 * Wraps an externally-created Pi Coding Agent session.
 */
export class PiCodingAgentProvider implements AgentProvider {
  private session: PiCodingAgentSession;

  constructor(config: PiCodingAgentProviderConfig) {
    this.session = config.session;
  }

  async createSession(): Promise<VoiceAgentSession> {
    return new PiCodingAgentSessionAdapter(this.session);
  }
}

/**
 * Adapts a Pi Coding Agent session to the VoiceAgentSession interface.
 * Maps AgentSessionEvents to AgentStreamEvents.
 */
class PiCodingAgentSessionAdapter implements VoiceAgentSession {
  private session: PiCodingAgentSession;

  constructor(session: PiCodingAgentSession) {
    this.session = session;
  }

  async *sendMessage(text: string): AsyncIterable<AgentStreamEvent> {
    // Use a queue to bridge the callback-based event system to an async iterable.
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

    // Subscribe to session events.
    // AgentSessionEvent extends AgentEvent, so we get all the core events
    // plus session-level events (auto_compaction, auto_retry, etc.)
    const unsubscribe = this.session.subscribe((event: PiAgentSessionEvent) => {
      const eventType: string = event.type;

      if (eventType === 'message_update') {
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
      // We silently ignore session-level events like auto_compaction_start/end,
      // auto_retry_start/end — the session handles them internally.
    });

    try {
      // Use session.prompt() which handles skill expansion, prompt templates,
      // validation, auto-compaction, retries, etc.
      const promptPromise = this.session.prompt(text).catch((err: Error) => {
        pushEvent({
          type: 'error',
          error: err.message ?? 'Pi Coding Agent error',
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

      await promptPromise;
    } finally {
      unsubscribe();
    }
  }

  async destroy(): Promise<void> {
    this.session.dispose();
  }
}

/**
 * Minimal type definitions for the Pi Coding Agent session.
 * These match the AgentSession API surface from @mariozechner/pi-coding-agent
 * without requiring the SDK at build time.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
interface PiAgentSessionEvent {
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
  // agent_end
  messages?: any[];
}

export interface PiCodingAgentSession {
  /** Send a prompt to the agent (handles skills, templates, validation, etc.) */
  prompt(text: string, options?: any): Promise<void>;
  /** Subscribe to session events. Returns unsubscribe function. */
  subscribe(listener: (event: PiAgentSessionEvent) => void): () => void;
  /** Clean up the session */
  dispose(): void;
  /** The underlying Agent instance */
  agent: any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
