/**
 * LLM Logger Service
 *
 * Minimal structured logging for the voice pipeline.
 * Logs: STT output, LLM responses, TTS input, tool calls, errors.
 */

// ============================================================================
// Structured Log Events
// ============================================================================

export type LLMLogEvent =
  | { type: 'new_conversation' }
  | { type: 'llm_call_start'; isFirstCall: boolean }
  | { type: 'llm_call_output' }
  | { type: 'llm_call_end' }
  | { type: 'system'; content: string }
  | { type: 'user'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; content: string }
  | { type: 'assistant'; content: string }
  | { type: 'response'; content: string }
  | { type: 'error'; message: string }
  | { type: 'tts'; content: string }
  | { type: 'tts_start' };

// ============================================================================
// Message Interface (matches the library's Message type)
// ============================================================================

/** Message interface for the tracker - mirrors the library's Message type */
export interface TrackerMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  toolCallId?: string;
}

// ============================================================================
// Logger Implementation
// ============================================================================

/**
 * Formats and displays structured LLM log events.
 * Only logs the key pipeline data: user input, LLM output, TTS input, tool calls, errors.
 */
export class LLMLogger {
  private enabled: boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  log(event: LLMLogEvent): void {
    if (!this.enabled) return;

    switch (event.type) {
      case 'user':
        console.log(`[stt] ${event.content}`);
        break;

      case 'response':
        console.log(`[llm] ${event.content}`);
        break;

      case 'tool_call':
        console.log(`[tool] ${event.name}(${this.formatArgs(event.args)})`);
        break;

      case 'tool_result':
        console.log(`[tool:result] ${event.content}`);
        break;

      case 'tts':
        console.log(`[tts] ${event.content}`);
        break;

      case 'error':
        console.error(`[error] ${event.message}`);
        break;

      // Intentionally silent for structural/decorative events
      case 'new_conversation':
      case 'llm_call_start':
      case 'llm_call_output':
      case 'llm_call_end':
      case 'system':
      case 'assistant':
      case 'tts_start':
        break;
    }
  }

  private formatArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

// ============================================================================
// Unified Conversation Tracker
// ============================================================================

/**
 * Tracks conversation state and emits structured events for new messages.
 * Works with Message[] arrays directly - used by all backends.
 * Each backend instance has its own tracker (per-session isolation).
 */
export class LLMConversationTracker {
  private loggedMessages: string[] = [];
  private callCount = 0;
  private logger: LLMLogger;

  constructor(logger: LLMLogger) {
    this.logger = logger;
  }

  logInput(messages: TrackerMessage[]): void {
    const newMessages: TrackerMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msgKey = this.messageKey(messages[i]);
      if (i >= this.loggedMessages.length || this.loggedMessages[i] !== msgKey) {
        newMessages.push(messages[i]);
        this.loggedMessages[i] = msgKey;
      }
    }
    this.loggedMessages.length = messages.length;
    this.callCount++;

    for (const msg of newMessages) {
      this.emitMessageEvent(msg);
    }
  }

  logOutput(content: string, toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>): void {
    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        this.logger.log({ type: 'tool_call', name: tc.name, args: tc.arguments });
      }
    } else if (content) {
      this.logger.log({ type: 'response', content });
    }
  }

  logRawOutput(response: string): void {
    const toolCall = this.parseToolCall(response);

    if (toolCall) {
      this.logOutput('', [toolCall]);
    } else {
      this.logOutput(response);
    }
  }

  reset(): void {
    this.loggedMessages = [];
    this.callCount = 0;
  }

  private messageKey(msg: TrackerMessage): string {
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      return `${msg.role}:toolcalls:${JSON.stringify(msg.toolCalls)}`;
    }
    return `${msg.role}:${msg.content}`;
  }

  private emitMessageEvent(msg: TrackerMessage): void {
    switch (msg.role) {
      case 'user':
        this.logger.log({ type: 'user', content: msg.content });
        break;

      case 'tool':
        this.logger.log({ type: 'tool_result', content: msg.content });
        break;

      case 'system':
      case 'assistant':
        break;
    }
  }

  private parseToolCall(content: string): { name: string; arguments: Record<string, unknown> } | null {
    const match = content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[1].trim());
      const call = Array.isArray(parsed) ? parsed[0] : parsed;
      return { name: call.name, arguments: call.arguments || {} };
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Singleton instance for convenience
// ============================================================================

let defaultLogger: LLMLogger | null = null;
let defaultTracker: LLMConversationTracker | null = null;

export function getDefaultLogger(): LLMLogger {
  if (!defaultLogger) {
    defaultLogger = new LLMLogger();
  }
  return defaultLogger;
}

export function getDefaultTracker(): LLMConversationTracker {
  if (!defaultTracker) {
    defaultTracker = new LLMConversationTracker(getDefaultLogger());
  }
  return defaultTracker;
}
