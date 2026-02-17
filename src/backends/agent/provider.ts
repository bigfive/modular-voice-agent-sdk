/**
 * Agent Provider Interface
 * Abstracts different agent SDKs (OpenCode, Pi Agent, etc.) behind a common interface.
 *
 * Agent SDKs manage their own tool execution loop internally.
 * The provider streams events back so the voice pipeline can:
 * - Stream text tokens to the client in real-time
 * - Show tool activity in the UI (for feedback, not execution)
 */

/**
 * Streaming event from an agent session.
 * These events are emitted as the agent processes a message,
 * including tool calls that the agent executes internally.
 */
export interface AgentStreamEvent {
  type: 'text_delta' | 'tool_call_start' | 'tool_call_end' | 'error' | 'done';

  /** Text content delta (for 'text_delta' events) */
  content?: string;

  /** Tool call information (for 'tool_call_start' and 'tool_call_end' events) */
  toolCall?: {
    id: string;
    name: string;
    arguments?: Record<string, unknown>;
    result?: unknown;
    isError?: boolean;
  };

  /** Error message (for 'error' events) */
  error?: string;
}

/**
 * An active agent session.
 * Wraps the underlying SDK's session/agent instance.
 * The session maintains its own conversation history internally.
 */
export interface AgentSession {
  /**
   * Send a message to the agent and stream back events.
   * The agent handles tool execution internally — the caller
   * only receives text deltas and tool activity notifications.
   *
   * @param text - User message text
   * @returns Async iterable of stream events
   */
  sendMessage(text: string): AsyncIterable<AgentStreamEvent>;

  /**
   * Clean up the session and release resources.
   */
  destroy(): Promise<void>;
}

/**
 * Provider that creates agent sessions.
 * Each provider wraps a specific agent SDK.
 */
export interface AgentProvider {
  /**
   * Create a new agent session.
   * The session manages its own conversation history, tool execution, etc.
   */
  createSession(): Promise<AgentSession>;
}
