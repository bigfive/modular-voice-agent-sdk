/**
 * OpenCode Agent Provider
 * Wraps an OpenCode SDK session as an AgentProvider.
 *
 * The user creates the OpenCode client externally and passes in
 * the session API. This provider handles creating sessions and
 * mapping SSE events to AgentStreamEvents.
 *
 * @example
 * ```typescript
 * import { createOpencode } from '@opencode-ai/sdk';
 *
 * const opencode = await createOpencode({ ... });
 *
 * const pipeline = createVoicePipeline({
 *   create: () => ({
 *     stt: new CloudSTT({ ... }),
 *     llm: new AgentLLM(new OpenCodeAgentProvider({
 *       client: opencode.client,
 *     })),
 *     tts: null,
 *     systemPrompt: 'You are a coding assistant.',
 *   }),
 * });
 * ```
 */

import type { AgentProvider, AgentSession, AgentStreamEvent } from './provider';

/**
 * Configuration for the OpenCode agent provider.
 */
export interface OpenCodeAgentProviderConfig {
  /**
   * The OpenCode SDK client instance.
   * Created externally via createOpencode() or createOpencodeClient().
   */
  client: OpenCodeClient;
  /**
   * Model override (e.g., { providerID: 'anthropic', modelID: 'claude-sonnet-4-20250514' }).
   * If omitted, uses the server's default model.
   */
  model?: { providerID: string; modelID: string };
}

/**
 * OpenCode Agent Provider
 * Wraps an externally-created OpenCode client.
 */
export class OpenCodeAgentProvider implements AgentProvider {
  private config: OpenCodeAgentProviderConfig;

  constructor(config: OpenCodeAgentProviderConfig) {
    this.config = config;
  }

  async createSession(): Promise<AgentSession> {
    const client = this.config.client;

    // Create a new session on the OpenCode server
    const session = await client.session.create({ body: {} });
    const sessionId: string = session.id ?? session.data?.id;
    if (!sessionId) {
      throw new Error('OpenCode: Failed to create session — no session ID returned');
    }

    return new OpenCodeAgentSession(client, sessionId, this.config.model);
  }
}

/**
 * Active OpenCode agent session.
 * Manages the SSE event subscription and prompt sending.
 */
class OpenCodeAgentSession implements AgentSession {
  private client: OpenCodeClient;
  private sessionId: string;
  private model?: { providerID: string; modelID: string };

  constructor(
    client: OpenCodeClient,
    sessionId: string,
    model?: { providerID: string; modelID: string },
  ) {
    this.client = client;
    this.sessionId = sessionId;
    this.model = model;
  }

  async *sendMessage(text: string): AsyncIterable<AgentStreamEvent> {
    // Subscribe to SSE events before sending the prompt.
    // This ensures we capture all events including the first ones.
    const events = await this.client.event.subscribe();

    // Build prompt body
    const promptBody: OpenCodePromptBody = {
      parts: [{ type: 'text', text }],
    };
    if (this.model) {
      promptBody.model = this.model;
    }

    // Send the prompt (don't await — we process events as they stream)
    const promptPromise = this.client.session.prompt({
      path: { id: this.sessionId },
      body: promptBody,
    });

    // Track text we've already emitted to compute deltas.
    // OpenCode message.part.updated events contain the full accumulated text,
    // so we diff against what we've sent to produce incremental deltas.
    let emittedTextLength = 0;
    let done = false;

    try {
      for await (const event of events.stream) {
        // Filter events for our session
        const props = event.properties ?? event;
        const eventSessionId = props.sessionID ?? props.session_id;
        if (eventSessionId !== this.sessionId) {
          continue;
        }

        const eventType: string = event.type ?? event.event ?? '';

        if (eventType === 'message.part.updated') {
          const part = props.part ?? props;
          const partType: string = part?.type ?? '';

          if (partType === 'text') {
            // Text delta — OpenCode sends cumulative text, so compute the delta
            const fullText: string = part.text ?? part.content ?? '';
            if (fullText.length > emittedTextLength) {
              const delta = fullText.slice(emittedTextLength);
              emittedTextLength = fullText.length;
              yield { type: 'text_delta', content: delta };
            }
          } else if (partType === 'tool-invocation' || partType === 'tool_use') {
            const toolInvocation = part.toolInvocation ?? part;
            const state: string = toolInvocation.state ?? '';
            const toolName: string = toolInvocation.toolName ?? part.name ?? 'unknown';
            const toolCallId: string = toolInvocation.toolCallId ?? part.id ?? '';

            if (state === 'calling' || state === 'partial-call') {
              yield {
                type: 'tool_call_start',
                toolCall: {
                  id: toolCallId,
                  name: toolName,
                  arguments: toolInvocation.args ?? {},
                },
              };
            } else if (state === 'result') {
              yield {
                type: 'tool_call_end',
                toolCall: {
                  id: toolCallId,
                  name: toolName,
                  result: toolInvocation.result,
                },
              };
            }
          }
        } else if (eventType === 'session.error') {
          yield {
            type: 'error',
            error: props.error ?? props.message ?? 'Unknown OpenCode error',
          };
          done = true;
          break;
        } else if (eventType === 'session.idle') {
          // Reset text tracking for next message in this session
          emittedTextLength = 0;
          done = true;
          yield { type: 'done' };
          break;
        }
      }
    } finally {
      if (!done) {
        yield { type: 'done' };
      }
      // Wait for the prompt to resolve to catch any errors
      try {
        await promptPromise;
      } catch (err) {
        console.warn('OpenCode prompt error:', err);
      }
    }
  }

  async destroy(): Promise<void> {
    try {
      await this.client.session.delete({ path: { id: this.sessionId } });
    } catch {
      // Session may already be cleaned up
    }
  }
}

/**
 * Minimal type definitions for the OpenCode SDK client.
 * These match the SDK's API surface without requiring the SDK at build time.
 * The user passes in the real SDK client which satisfies this interface.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
interface OpenCodePromptBody {
  parts: Array<{ type: string; text: string }>;
  model?: { providerID: string; modelID: string };
}

export interface OpenCodeClient {
  session: {
    create(opts: { body: Record<string, unknown> }): Promise<any>;
    prompt(opts: { path: { id: string }; body: OpenCodePromptBody }): Promise<any>;
    delete(opts: { path: { id: string } }): Promise<any>;
  };
  event: {
    subscribe(): Promise<{ stream: AsyncIterable<any> }>;
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
