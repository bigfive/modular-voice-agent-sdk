/**
 * Pipeline Handler
 *
 * Framework-agnostic session handler for voice pipeline servers.
 * Supports capability negotiation - skips STT/TTS when client handles them.
 * Each session has its own conversation history, backends, and state.
 */

import type { VoicePipeline, ConversationContext, SessionBackends } from '../voice-pipeline';
import type { ClientMessage, ServerMessage } from '../client/protocol';
import { generateId } from '../client/protocol';
import type { Message } from '../types';
import { float32ToBase64Node, base64ToFloat32Node, concatFloat32Arrays } from './encoding';

export interface PipelineHandlerConfig {
  /** Silence timeout: no audio for this many ms = stream interrupted (default: 5000) */
  silenceTimeoutMs?: number;
  /** Max recording duration in ms (default: 90000) */
  maxRecordingMs?: number;
}

/**
 * Client capabilities - what the client handles locally
 */
interface ClientCapabilities {
  hasSTT: boolean;  // Client does STT - server won't send transcript
  hasTTS: boolean;  // Client does TTS - server won't send audio
  wantsTTS?: boolean;  // When false, server skips TTS. Default true.
}

type BusyState = 'idle' | 'recording' | 'processing';

const DEFAULT_SILENCE_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RECORDING_MS = 90000;

/**
 * A session represents a single client connection.
 * Each session has its own backends, conversation history, and state.
 */
export class PipelineSession {
  private audioChunks: Float32Array[] = [];
  private destroyed = false;
  private destroyedResolve: (() => void) | null = null;
  private capabilities: ClientCapabilities = {
    hasSTT: false,
    hasTTS: false,
  };

  /** Session's conversation history */
  private history: Message[] = [];

  /** Unique session identifier (ULID-based) */
  private readonly _sessionId: string;

  /** Current request being processed */
  private _currentRequestId: string | null = null;

  /** Busy state for recording/processing */
  private busyState: BusyState = 'idle';
  private recordingStarted = false;
  private recordingStartedAt: number | null = null;
  private lastAudioAt: number | null = null;
  private busyTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly silenceTimeoutMs: number;
  private readonly maxRecordingMs: number;
  private readonly onIdleCallbacks = new Set<() => void>();

  /** Per-request TTS suppression (set when client sends skipTTS on text message) */
  private currentSkipTTS = false;

  /** Private constructor - use PipelineSession.create() */
  private constructor(
    private pipeline: VoicePipeline,
    private backends: SessionBackends,
    config: PipelineHandlerConfig = {}
  ) {
    // Generate unique session ID
    this._sessionId = generateId('ses');
    // Initialize history with system prompt
    this.history = [{ role: 'system', content: this.pipeline.getSystemPrompt() }];
    this.silenceTimeoutMs = config.silenceTimeoutMs ?? DEFAULT_SILENCE_TIMEOUT_MS;
    this.maxRecordingMs = config.maxRecordingMs ?? DEFAULT_MAX_RECORDING_MS;
  }

  /**
   * Create a new session with its own backend instances.
   * Each session gets fresh backends for proper isolation.
   */
  static async create(pipeline: VoicePipeline, config: PipelineHandlerConfig = {}): Promise<PipelineSession> {
    const backends = await pipeline.createSessionBackends();
    return new PipelineSession(pipeline, backends, config);
  }

  /**
   * Get the conversation context for this session
   */
  private getContext(): ConversationContext {
    return {
      history: this.history,
    };
  }

  /**
   * Handle an incoming message and yield response messages
   */
  async *handle(message: ClientMessage): AsyncGenerator<ServerMessage> {
    if (this.destroyed) return;

    switch (message.type) {
      case 'capabilities':
        // Client is telling us what it handles locally
        this.capabilities = {
          hasSTT: message.hasSTT,
          hasTTS: message.hasTTS,
          wantsTTS: message.wantsTTS ?? true,
        };
        break;

      case 'recording_start':
        this.enterRecordingState();
        break;

      case 'audio':
        if (!this.recordingStarted) {
          yield { type: 'error', message: 'Protocol violation: audio received without recording_start' };
          break;
        }
        this.audioChunks.push(base64ToFloat32Node(message.data));
        this.lastAudioAt = Date.now();
        this.scheduleBusyTimeout();
        break;

      case 'end_audio':
        this.clearBusyTimeout();
        this.recordingStarted = false;
        this.busyState = 'processing';
        try {
          yield* this.processAudio();
        } finally {
          this.setIdle();
        }
        break;

      case 'text':
        // Client did STT locally - process text directly
        this.currentSkipTTS = message.skipTTS ?? false;
        this.busyState = 'processing';
        try {
          yield* this.processText(message.text);
        } finally {
          this.currentSkipTTS = false;
          this.setIdle();
        }
        break;

      case 'clear_history':
        // Reset session history
        this.history = [{ role: 'system', content: this.pipeline.getSystemPrompt() }];
        break;
    }
  }

  private enterRecordingState(): void {
    this.recordingStarted = true;
    this.recordingStartedAt = Date.now();
    this.lastAudioAt = Date.now();
    this.busyState = 'recording';
    this.scheduleBusyTimeout();
  }

  private scheduleBusyTimeout(): void {
    this.clearBusyTimeout();
    const elapsed = this.recordingStartedAt ? Date.now() - this.recordingStartedAt : 0;
    const remainingMax = Math.max(0, this.maxRecordingMs - elapsed);
    const silenceElapsed = this.lastAudioAt ? Date.now() - this.lastAudioAt : 0;
    const remainingSilence = Math.max(0, this.silenceTimeoutMs - silenceElapsed);
    const timeoutMs = Math.min(remainingMax, remainingSilence);
    this.busyTimeoutHandle = setTimeout(() => this.forceEndRecording(), timeoutMs);
  }

  private clearBusyTimeout(): void {
    if (this.busyTimeoutHandle) {
      clearTimeout(this.busyTimeoutHandle);
      this.busyTimeoutHandle = null;
    }
  }

  private forceEndRecording(): void {
    this.clearBusyTimeout();
    if (this.audioChunks.length > 0) {
      console.warn('[PipelineSession] Recording timeout: discarding partial audio');
    }
    this.audioChunks = [];
    this.recordingStarted = false;
    this.recordingStartedAt = null;
    this.lastAudioAt = null;
    this.busyState = 'idle';
    this.fireIdleCallbacks();
  }

  private setIdle(): void {
    this.busyState = 'idle';
    this.fireIdleCallbacks();
  }

  private fireIdleCallbacks(): void {
    for (const cb of this.onIdleCallbacks) {
      try {
        cb();
      } catch (err) {
        console.error('[PipelineSession] onIdle callback error:', err);
      }
    }
  }

  /**
   * True while receiving audio, processing a turn, or waiting for pipeline.
   */
  isBusy(): boolean {
    return this.busyState !== 'idle';
  }

  /**
   * Subscribe to idle transitions. Called when a turn completes (recording→processing→idle).
   * Returns unsubscribe function.
   */
  onIdle(callback: () => void): () => void {
    this.onIdleCallbacks.add(callback);
    return () => this.onIdleCallbacks.delete(callback);
  }

  /**
   * Inject a text message from the server. Runs through pipeline (LLM → TTS).
   * Yields ServerMessage — caller must iterate and send to client (e.g. WebSocket).
   *
   * @throws Error if session is busy (check isBusy() first, or queue externally)
   */
  async *injectFromServer(text: string): AsyncGenerator<ServerMessage> {
    if (this.destroyed) return;
    if (this.isBusy()) {
      throw new Error('Session is busy');
    }
    this.busyState = 'processing';
    try {
      yield* this.processText(text);
    } finally {
      this.setIdle();
    }
  }

  /**
   * Get client capabilities
   */
  getCapabilities(): ClientCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Get the session ID (ULID-based, format: ses_<ulid>)
   */
  getSessionId(): string {
    return this._sessionId;
  }

  /**
   * Get the current request ID being processed
   */
  getCurrentRequestId(): string | null {
    return this._currentRequestId;
  }

  /**
   * Set the current request ID (called by transport layer when processing a request)
   */
  setCurrentRequestId(requestId: string | null): void {
    this._currentRequestId = requestId;
  }

  /**
   * Get the current conversation history.
   * Useful for persisting state or resuming sessions.
   */
  getHistory(): readonly Message[] {
    return this.history;
  }

  /**
   * Set the conversation history.
   * Use this to restore a previous session's state.
   * Note: Should include the system prompt as the first message if needed.
   *
   * This method also repairs incomplete tool call sequences - if an assistant
   * message has tool_use but no following tool_result (e.g., session was
   * interrupted), placeholder results are added to satisfy the API requirement.
   */
  setHistory(messages: Message[]): void {
    this.history = this.repairHistory([...messages]);
  }

  /**
   * Repair history by ensuring every tool_use has a corresponding tool_result.
   * The Claude API requires tool_result blocks immediately after tool_use blocks.
   */
  private repairHistory(messages: Message[]): Message[] {
    const repaired: Message[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      repaired.push(msg);

      // Check if this is an assistant message with tool calls
      if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls && msg.toolCalls.length > 0) {
        const toolCalls = msg.toolCalls;

        // Collect all tool_result messages that immediately follow
        const toolResultIds = new Set<string>();
        let j = i + 1;
        while (j < messages.length && messages[j].role === 'tool') {
          const toolMsg = messages[j] as { role: 'tool'; toolCallId: string; content: string };
          toolResultIds.add(toolMsg.toolCallId);
          j++;
        }

        // Add placeholder results for any missing tool calls
        for (const tc of toolCalls) {
          if (!toolResultIds.has(tc.id)) {
            console.warn(`Repairing history: Adding placeholder tool_result for ${tc.name} (${tc.id})`);
            repaired.push({
              role: 'tool',
              toolCallId: tc.id,
              content: JSON.stringify({ error: 'Session was interrupted before tool completed' }),
            } as Message);
          }
        }
      }
    }

    return repaired;
  }

  /**
    * Backends for current turn. When skipServerTTS, passes tts: null so pipeline skips TTS.
    */
  private getBackendsForTurn(): SessionBackends {
    const skipServerTTS =
      this.capabilities.hasTTS ||
      this.capabilities.wantsTTS === false ||
      this.currentSkipTTS ||
      !this.pipeline.hasTTS();
    return skipServerTTS ? { ...this.backends, tts: null } : this.backends;
  }

  /**
    * Whether TTS should be suppressed entirely (neither server nor client should speak).
    */
  private suppressAllTTS(): boolean {
    return this.capabilities.wantsTTS === false || this.currentSkipTTS;
  }

  /**
   * Process accumulated audio through the pipeline (STT → LLM → TTS)
   */
  private async *processAudio(): AsyncGenerator<ServerMessage> {
    if (this.audioChunks.length === 0) return;

    if (!this.pipeline.hasSTT()) {
      yield { type: 'error', message: 'No STT backend configured on server. Client should use local STT and send text.' };
      return;
    }

    const audio = concatFloat32Arrays(this.audioChunks);
    this.audioChunks = [];

    const backends = this.getBackendsForTurn();
    yield* this.runPipeline((callbacks) =>
      this.pipeline.processAudio(audio, this.getContext(), callbacks, backends)
    );
  }

  /**
   * Process text through the pipeline (LLM → TTS)
   */
  private async *processText(text: string): AsyncGenerator<ServerMessage> {
    // Emit the transcript so client knows what was received
    // (useful for debugging, client can ignore if it already has transcript)
    yield { type: 'transcript', text };

    const backends = this.getBackendsForTurn();
    yield* this.runPipeline((callbacks) =>
      this.pipeline.processText(text, this.getContext(), callbacks, backends)
    );
  }

  /**
   * Run the pipeline and yield messages as they arrive
   */
  private async *runPipeline(
    run: (callbacks: Parameters<VoicePipeline['processAudio']>[2]) => Promise<Message[]>
  ): AsyncGenerator<ServerMessage> {
    const messageQueue: ServerMessage[] = [];
    let resolveWaiting: (() => void) | null = null;
    let isComplete = false;

    const enqueue = (msg: ServerMessage) => {
      messageQueue.push(msg);
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    };

    // Defense in depth: skip audio if server TTS was disabled for this turn
    const serverSkipsTTS = this.getBackendsForTurn().tts === null;

    // Signal to client whether TTS should be fully suppressed
    const suppressTTS = this.suppressAllTTS();

    // Start pipeline processing
    const pipelinePromise = run({
      onTranscript: (text) => enqueue({ type: 'transcript', text }),
      onResponseChunk: (text) => enqueue({ type: 'response_chunk', text, skipTTS: suppressTTS || undefined }),
      onAudio: (playable) => {
        // Skip audio if client handles TTS locally
        if (serverSkipsTTS) return;

        const raw = playable.getRawAudio();
        if (!raw) {
          // TTS backend doesn't provide raw audio (e.g., WebSpeechTTS)
          // This is a config error - server TTS must produce raw audio
          enqueue({
            type: 'error',
            message: 'Server TTS backend does not provide raw audio. Use a TTS backend that produces raw audio (TransformersTTS, NativeTTS), or configure client with localTTS.',
          });
          isComplete = true;
          return;
        }
        enqueue({
          type: 'audio',
          data: float32ToBase64Node(raw.audio),
          sampleRate: raw.sampleRate,
        });
      },
      onToolCall: (toolCall) => {
        enqueue({
          type: 'tool_call',
          toolCallId: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });
      },
      onToolResult: (toolCallId, result) => {
        enqueue({
          type: 'tool_result',
          toolCallId,
          result,
        });
      },
      onComplete: () => {
        enqueue({ type: 'complete' });
        isComplete = true;
      },
      onError: (err) => {
        enqueue({ type: 'error', message: err.message });
        isComplete = true;
      },
      // Pass cancellation check to pipeline - stops tool execution when session destroyed
      isCancelled: () => this.destroyed,
    });

    // Yield messages as they arrive
    // Exit early if session is destroyed (user cancelled)
    while ((!isComplete || messageQueue.length > 0) && !this.destroyed) {
      if (messageQueue.length > 0) {
        yield messageQueue.shift()!;
      } else if (!isComplete) {
        await new Promise<void>((resolve) => {
          resolveWaiting = resolve;
          // Store resolve so destroy() can wake us up
          this.destroyedResolve = resolve;
        });
        this.destroyedResolve = null;
      }
    }

    // Only await pipeline if not destroyed - let cancelled pipelines die in background
    if (!this.destroyed) {
      await pipelinePromise;
    }
  }

  /**
   * Clean up session resources.
   * Also signals any in-progress pipeline to stop yielding messages.
   */
  destroy(): void {
    this.destroyed = true;
    this.audioChunks = [];
    this.clearBusyTimeout();
    this.recordingStarted = false;
    this.busyState = 'idle';
    this.onIdleCallbacks.clear();
    // Wake up any waiting promise so runPipeline can exit its loop
    if (this.destroyedResolve) {
      this.destroyedResolve();
      this.destroyedResolve = null;
    }
  }
}

/**
 * Pipeline handler factory
 */
export class PipelineHandler {
  constructor(
    private pipeline: VoicePipeline,
    private config: PipelineHandlerConfig = {}
  ) {}

  /**
   * Create a new session for a client connection.
   * Each session gets its own backend instances for isolation.
   */
  async createSession(): Promise<PipelineSession> {
    return PipelineSession.create(this.pipeline, this.config);
  }

  /**
   * Get info about what the pipeline handles
   */
  getPipelineInfo(): { hasSTT: boolean; hasTTS: boolean } {
    return {
      hasSTT: this.pipeline.hasSTT(),
      hasTTS: this.pipeline.hasTTS(),
    };
  }
}

/**
 * Create a pipeline handler
 */
export function createPipelineHandler(
  pipeline: VoicePipeline,
  config?: PipelineHandlerConfig
): PipelineHandler {
  return new PipelineHandler(pipeline, config);
}
