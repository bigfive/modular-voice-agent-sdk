/**
 * Voice Client
 *
 * Unified browser SDK for voice assistants.
 * Handles three modes:
 * 1. Fully local - all components run in browser, no server needed
 * 2. Fully remote - all processing on server via transport
 * 3. Hybrid - mix of local and server components
 *
 * Component logic:
 * - Component provided → runs locally
 * - Component is null + serverUrl/transport → server handles it
 * - All components local → no server connection needed
 *
 * Transport:
 * - Default: WebSocketTransport (when serverUrl is provided)
 * - Custom: Pass any Transport implementation via the transport option
 * - Built-in alternatives: HttpSseTransport (HTTP POST + SSE)
 */

import type { STTPipeline, LLMPipeline, TTSPipeline, AudioPlayable, ProgressCallback } from '../types';
import { VoicePipeline } from '../voice-pipeline';
import { AudioRecorder } from './audio-recorder';
import { AudioPlayer } from './audio-player';
import { WebSpeechSTT } from './web-speech-stt';
import { WebSpeechTTS } from './web-speech-tts';
import {
  float32ToBase64,
  base64ToFloat32,
  generateId,
  type ClientMessage,
  type ClientEnvelope,
  type ServerEnvelope,
} from './protocol';
import type { Transport } from './transport';
import { WebSocketTransport } from './transports/websocket';

// ============ Types ============

export interface BrowserSupport {
  /** Web Speech API speech recognition (Chrome, Edge, Safari only) */
  webSpeechSTT: boolean;
  /** Web Speech API speech synthesis (most browsers) */
  webSpeechTTS: boolean;
  /** WebGPU for ML acceleration (Chrome, Edge) */
  webGPU: boolean;
  /** MediaDevices API for microphone access */
  mediaDevices: boolean;
  /** WebSocket support */
  webSocket: boolean;
  /** AudioContext for audio processing */
  audioContext: boolean;
  /** Whether the browser is Brave (blocks WebSpeech STT for privacy) */
  isBrave: boolean;
  /** Whether WebSpeech STT is actually usable (exists AND not blocked by Brave) */
  webSpeechSTTUsable: boolean;
}

export type VoiceClientStatus =
  | 'disconnected'
  | 'connecting'
  | 'initializing'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'speaking';

/**
 * Components returned by the client factory
 */
export interface ClientComponents {
  /**
   * STT backend - runs locally in browser
   * - Provide an STTPipeline (e.g., TransformersSTT) or WebSpeechSTT for local STT
   * - Set to null to use server-side STT (requires serverUrl)
   * @default null (server handles)
   */
  stt: STTPipeline | WebSpeechSTT | null;

  /**
   * LLM backend - runs locally in browser
   * - Provide an LLMPipeline (e.g., TransformersLLM) for local LLM
   * - Set to null to use server-side LLM (requires serverUrl)
   * @default null (server handles)
   */
  llm: LLMPipeline | null;

  /**
   * TTS backend - runs locally in browser
   * - Provide a TTSPipeline (e.g., TransformersTTS) or WebSpeechTTS for local TTS
   * - Set to null to use server-side TTS (requires serverUrl)
   * @default null (server handles)
   */
  tts: TTSPipeline | WebSpeechTTS | null;

  /**
   * System prompt for the LLM (required if llm is provided)
   */
  systemPrompt?: string;

  /**
   * Server URL (required if any component is null).
   * When no custom transport is provided, this creates a WebSocketTransport.
   * For WebSocket: 'ws://localhost:3000'
   * For HTTP+SSE: use a custom transport instead
   */
  serverUrl?: string;

  /**
   * Custom transport for server communication.
   * Overrides serverUrl when provided.
   * Use this for non-WebSocket transports (HTTP+SSE, postMessage, etc.)
   *
   * @example
   * ```typescript
   * import { HttpSseTransport } from 'modular-voice-agent-sdk/client';
   * {
   *   transport: new HttpSseTransport('http://localhost:3000'),
   * }
   * ```
   */
  transport?: Transport;
}

import type { ModelStore } from '../voice-pipeline';

/**
 * Factory function that creates client components.
 *
 * @param modelStore - Pipeline-scoped cache for heavy resources.
 *   Backends can use this to cache models across sessions (for fully-local mode).
 *   Typically not needed for client-side backends like WebSpeechTTS.
 */
export type ClientComponentFactory = (modelStore: ModelStore) => ClientComponents;

export interface VoiceClientConfig {
  /**
   * Factory that creates components.
   * Called once during client construction.
   *
   * The factory receives a `modelStore` for caching heavy resources.
   * This is mainly useful for fully-local mode with Transformers backends.
   *
   * @example
   * ```typescript
   * // Simple: server handles heavy lifting
   * createVoiceClient({
   *   create: (modelStore) => ({
   *     stt: null,
   *     llm: null,
   *     tts: new WebSpeechTTS(),
   *     serverUrl: 'ws://localhost:3100',
   *   }),
   * });
   *
   * // Fully local with Transformers (uses modelStore for caching)
   * createVoiceClient({
   *   create: (modelStore) => ({
   *     stt: new TransformersSTT(sttConfig, modelStore),
   *     llm: new TransformersLLM(llmConfig, modelStore),
   *     tts: new TransformersTTS(ttsConfig, modelStore),
   *     systemPrompt: 'You are a helpful assistant.',
   *   }),
   * });
   * ```
   */
  create: ClientComponentFactory;

  /**
   * Audio sample rate for recording (default: 16000)
   */
  sampleRate?: number;

  /**
   * Auto-reconnect on disconnect - only applies when using server (default: true)
   */
  autoReconnect?: boolean;

  /**
   * Reconnect delay in ms (default: 2000)
   */
  reconnectDelay?: number;

  /**
   * Timeout in ms for connect() to wait for full session initialization (default: 10000).
   * connect() waits for the server to send session_init before resolving.
   * Set to 0 to disable (resolve as soon as transport connects, like pre-v2 behavior).
   */
  connectTimeout?: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Metadata passed to event callbacks for request/response correlation.
 * - requestId: The client-generated request ID for this user turn
 * - responseId: The server-generated response ID for this specific message (null for local mode)
 */
export interface EventMeta {
  requestId: string;
  responseId: string | null;
}

export interface VoiceClientEvents {
  /** Connection/initialization status changed */
  status: (status: VoiceClientStatus) => void;
  /** User transcript received (from STT) */
  transcript: (text: string, meta: EventMeta) => void;
  /** Assistant response chunk (streaming) */
  responseChunk: (text: string, meta: EventMeta) => void;
  /** Full response complete */
  responseComplete: (fullText: string, meta: EventMeta) => void;
  /** Tool call started (function calling) */
  toolCall: (toolCall: ToolCallInfo, meta: EventMeta) => void;
  /** Tool call result received */
  toolResult: (toolCallId: string, result: unknown, meta: EventMeta) => void;
  /** Error occurred */
  error: (error: Error, meta: EventMeta) => void;
  /** Model loading progress (for local models) */
  progress: (info: { status: string; file?: string; progress?: number }) => void;
}

type EventName = keyof VoiceClientEvents;
type EventCallback<K extends EventName> = VoiceClientEvents[K];

// ============ Helpers ============

function isWebSpeechSTT(obj: unknown): obj is WebSpeechSTT {
  return obj instanceof WebSpeechSTT;
}

function isWebSpeechTTS(obj: unknown): obj is WebSpeechTTS {
  return obj instanceof WebSpeechTTS;
}

/**
 * Create EventMeta for local mode (no server responseId)
 */
function createLocalMeta(requestId: string | null): EventMeta {
  return { requestId: requestId ?? '', responseId: null };
}

// ============ Voice Client ============

export class VoiceClient {
  // ============ Static Methods ============

  /**
   * Check browser support for voice features.
   * Call this before creating a VoiceClient to determine what's available.
   *
   * @example
   * const support = VoiceClient.getBrowserSupport();
   * if (!support.webSpeechSTT) {
   *   showMessage("Voice input requires Chrome, Edge, or Safari");
   * }
   */
  static getBrowserSupport(): BrowserSupport {
    const hasWindow = typeof window !== 'undefined';

    const webSpeechSTT = hasWindow && !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );

    // Brave has WebSpeech API but blocks it for privacy (connects to Google)
    const isBrave = hasWindow && (navigator as any).brave !== undefined;

    return {
      webSpeechSTT,
      webSpeechTTS: hasWindow && 'speechSynthesis' in window,
      webGPU: hasWindow && 'gpu' in navigator,
      mediaDevices: hasWindow && !!(navigator.mediaDevices?.getUserMedia),
      webSocket: hasWindow && 'WebSocket' in window,
      audioContext: hasWindow && !!(
        (window as any).AudioContext ||
        (window as any).webkitAudioContext
      ),
      isBrave,
      webSpeechSTTUsable: webSpeechSTT && !isBrave,
    };
  }

  /**
   * Get a human-readable description of what's not supported.
   * Returns null if everything needed for basic operation is supported.
   */
  static getUnsupportedFeatures(): string[] {
    const support = VoiceClient.getBrowserSupport();
    const issues: string[] = [];

    if (support.isBrave) {
      issues.push('Speech recognition (WebSpeech STT) - Brave blocks this for privacy. Use Chrome, Edge, Safari, or TransformersSTT');
    } else if (!support.webSpeechSTT) {
      issues.push('Speech recognition (WebSpeech STT) - use Chrome, Edge, or Safari, or use TransformersSTT for local transcription');
    }
    if (!support.mediaDevices) {
      issues.push('Microphone access (MediaDevices API)');
    }
    if (!support.audioContext) {
      issues.push('Audio processing (AudioContext)');
    }
    if (!support.webSocket) {
      issues.push('WebSocket connections');
    }

    return issues;
  }

  // ============ Instance Properties ============

  private config: {
    sampleRate: number;
    autoReconnect: boolean;
    reconnectDelay: number;
    connectTimeout: number;
    serverUrl?: string;
    systemPrompt: string;
  };

  // Mode detection
  private mode: 'local' | 'remote' | 'hybrid';
  private needsServer: boolean;

  // Model store for caching (passed to factory)
  private modelStore: ModelStore = new Map();

  // Local components
  private localSTT: STTPipeline | WebSpeechSTT | null = null;
  private localLLM: LLMPipeline | null = null;
  private localTTS: TTSPipeline | WebSpeechTTS | null = null;
  private localPipeline: VoicePipeline | null = null;

  // Remote/hybrid components
  private transport: Transport | null = null;
  private recorder: AudioRecorder | null = null;
  private player: AudioPlayer | null = null;

  // State
  private status: VoiceClientStatus = 'disconnected';
  private listeners = new Map<EventName, Set<EventCallback<EventName>>>();
  private currentResponse = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTTSText = '';
  private ttsQueue: string[] = [];
  private localTTSActive = false;

  // Conversation state (for local mode)
  private history: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [];

  // Recording state for local pipeline
  private audioContext: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private mediaRecording = false;

  // Session/request tracking for envelope protocol
  private sessionId: string | null = null;
  private currentRequestId: string | null = null;

  // Tracks whether server has sent 'complete' message (for server TTS timing)
  private responseComplete = true;

  /** Tracks whether server signaled TTS was skipped for current response. */
  private lastSkipTTS = false;

  /** When false, server skips TTS. Default true. */
  private wantsTTS = true;

  constructor(config: VoiceClientConfig) {
    // Get components from factory, passing modelStore for caching
    const components = config.create(this.modelStore);

    // Check browser support first
    this.validateBrowserSupport(components);

    // Determine what's local vs remote
    const hasLocalSTT = components.stt !== null;
    const hasLocalLLM = components.llm !== null;
    const hasLocalTTS = components.tts !== null;

    this.needsServer = !hasLocalSTT || !hasLocalLLM || !hasLocalTTS;

    if (!hasLocalSTT && !hasLocalLLM && !hasLocalTTS) {
      this.mode = 'remote';
    } else if (hasLocalSTT && hasLocalLLM && hasLocalTTS) {
      this.mode = 'local';
    } else {
      this.mode = 'hybrid';
    }

    // Validate config
    if (this.needsServer && !components.serverUrl && !components.transport) {
      throw new Error(
        'serverUrl or transport is required when any component (stt, llm, tts) is null. ' +
        'Either provide all components for fully-local mode, or specify a serverUrl or custom transport.'
      );
    }

    // Create transport from serverUrl if no custom transport provided
    if (components.transport) {
      this.transport = components.transport;
    } else if (components.serverUrl) {
      this.transport = new WebSocketTransport(components.serverUrl);
    }

    if (hasLocalLLM && !components.systemPrompt) {
      throw new Error('systemPrompt is required when using a local LLM');
    }

    this.config = {
      sampleRate: config.sampleRate ?? 16000,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 2000,
      connectTimeout: config.connectTimeout ?? 10000,
      serverUrl: components.serverUrl,
      systemPrompt: components.systemPrompt ?? '',
    };

    // Store local components
    if (hasLocalSTT) this.localSTT = components.stt;
    if (hasLocalLLM) this.localLLM = components.llm;
    if (hasLocalTTS) this.localTTS = components.tts;

    // Set up based on mode
    this.setupComponents();
  }

  private setupComponents(): void {
    // Set up STT (local or recorder for server)
    if (this.localSTT) {
      if (isWebSpeechSTT(this.localSTT)) {
        this.setupWebSpeechSTT();
      }
      // For STTPipeline, we'll use MediaRecorder to capture audio, then process locally
    } else if (this.needsServer) {
      // Use AudioRecorder for server-side STT
      this.recorder = new AudioRecorder({ sampleRate: this.config.sampleRate });
      this.recorder.onChunk((chunk) => {
        this.send({
          type: 'audio',
          data: float32ToBase64(chunk),
          sampleRate: this.config.sampleRate,
        });
      });
    }

    // Set up TTS (local or player for server)
    if (this.localTTS) {
      // WebSpeechTTS or TTSPipeline - handled in handleLocalTTS methods
    } else if (this.needsServer) {
      // Use AudioPlayer for server audio
      this.player = new AudioPlayer({
        onStart: () => this.setStatus('speaking'),
        onEnd: () => {
          // Only go to 'ready' if server has sent 'complete' message
          // (otherwise we're just waiting for the next audio chunk)
          if (this.status === 'speaking' && this.responseComplete) {
            this.setStatus('ready');
          }
        },
      });
    }

    // Create local pipeline if fully local
    if (this.mode === 'local') {
      // For local mode with WebSpeech components, we need to handle them separately
      const sttForPipeline = isWebSpeechSTT(this.localSTT) ? null : (this.localSTT as STTPipeline);
      const ttsForPipeline = isWebSpeechTTS(this.localTTS) ? null : (this.localTTS as TTSPipeline);

      // Use the new single-factory pattern
      // Note: modelStore is ignored here since components were already created above
      this.localPipeline = new VoicePipeline({
        create: (/* modelStore */) => ({
          stt: sttForPipeline,
          llm: this.localLLM!,
          tts: ttsForPipeline,
          systemPrompt: this.config.systemPrompt,
        }),
      });
    }
  }

  private setupWebSpeechSTT(): void {
    const webSpeechSTT = this.localSTT as WebSpeechSTT;

    webSpeechSTT.onResult((result) => {
      if (result.isFinal && result.transcript.trim()) {
        const text = result.transcript.trim();
        this.emit('transcript', text, createLocalMeta(this.currentRequestId));

        if (this.mode === 'local' || (this.mode === 'hybrid' && this.localLLM)) {
          // Process locally
          this.processTextLocally(text);
        } else {
          // Send to server
          this.send({ type: 'text', text });
          this.setStatus('processing');
        }
      }
    });

    webSpeechSTT.onEnd(() => {
      if (this.status === 'listening') {
        this.setStatus('ready');
      }
    });

    webSpeechSTT.onError((error) => {
      this.emit('error', error, createLocalMeta(this.currentRequestId));
      this.setStatus('ready');
    });
  }

  // ============ Public API ============

  /**
   * Send a text message through the voice pipeline (bypasses STT).
   * For typed input that shouldn't trigger TTS (user can read the response).
   */
  sendText(text: string): void {
    if (this.status !== 'ready' && this.status !== 'speaking') return;
    if (!text.trim()) return;

    this.currentRequestId = generateId('req');
    this.responseComplete = false;
    this.currentResponse = '';

    this.stopSpeaking();

    this.emit('transcript', text.trim(), createLocalMeta(this.currentRequestId));

    if (this.mode === 'local' || (this.mode === 'hybrid' && this.localLLM)) {
      void this.processTextLocally(text, { skipTTS: true });
    } else {
      this.send({ type: 'text', text, skipTTS: true });
      this.setStatus('processing');
    }
  }

  /**
   * Initialize and connect (if using server)
   */
  async connect(): Promise<void> {
    // Initialize local components
    if (this.localSTT || this.localLLM || this.localTTS) {
      this.setStatus('initializing');
      await this.initializeLocalComponents();
    }

    // Connect to server if needed
    if (this.needsServer) {
      await this.connectTransport();
    } else {
      this.setStatus('ready');
    }
  }

  private async initializeLocalComponents(): Promise<void> {
    const progressCallback: ProgressCallback = (progress) => {
      this.emit('progress', {
        status: progress.status,
        file: progress.file,
        progress: progress.progress,
      });
    };

    // If fully local mode, use localPipeline to initialize everything
    if (this.localPipeline) {
      await this.localPipeline.initialize(progressCallback);
      return;
    }

    // Otherwise initialize components directly (hybrid or remote mode)
    const promises: Promise<void>[] = [];

    if (this.localSTT && !isWebSpeechSTT(this.localSTT)) {
      promises.push(this.localSTT.initialize(progressCallback));
    }

    if (this.localLLM) {
      promises.push(this.localLLM.initialize(progressCallback));
    }

    if (this.localTTS) {
      if (isWebSpeechTTS(this.localTTS)) {
        promises.push(this.localTTS.initialize());
      } else {
        promises.push(this.localTTS.initialize(progressCallback));
      }
    }

    await Promise.all(promises);
  }

  private async connectTransport(): Promise<void> {
    if (!this.transport) return;
    if (this.transport.readyState === 'open') return;

    this.setStatus('connecting');

    const sessionReady = this.config.connectTimeout > 0
      ? this.waitForSessionInit()
      : null;

    // Register handlers before connecting
    this.transport.onMessage((envelope) => {
      this.handleServerEnvelope(envelope);
    });

    this.transport.onClose(() => {
      this.sessionId = null;
      this.currentRequestId = null;
      this.setStatus('disconnected');
      if (this.config.autoReconnect && this.needsServer) {
        this.scheduleReconnect();
      }
    });

    this.transport.onError((error) => {
      this.emit('error', error, createLocalMeta(this.currentRequestId));
    });

    await this.transport.connect();

    if (sessionReady) {
      await sessionReady;
    }
  }

  /**
   * Returns a promise that resolves when status becomes 'ready' (i.e. session_init received),
   * or rejects on timeout / transport close.
   */
  private waitForSessionInit(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.status === 'ready' && this.sessionId !== null) {
        resolve();
        return;
      }

      let timer: ReturnType<typeof setTimeout> | null = null;
      let statusCb: VoiceClientEvents['status'] | null = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (statusCb) this.off('status', statusCb);
      };

      statusCb = (status: VoiceClientStatus) => {
        if (status === 'ready') {
          cleanup();
          resolve();
        } else if (status === 'disconnected') {
          cleanup();
          reject(new Error('Transport closed before session was initialized'));
        }
      };
      this.on('status', statusCb);

      timer = setTimeout(() => {
        timer = null;
        cleanup();
        reject(new Error(
          `Connection timed out after ${this.config.connectTimeout}ms waiting for session initialization`
        ));
      }, this.config.connectTimeout);
    });
  }

  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    this.config.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.transport?.close();

    // Stop any TTS
    if (isWebSpeechTTS(this.localTTS)) {
      this.localTTS.stop();
    }

    this.setStatus('disconnected');
  }

  /**
   * Start recording/listening
   */
  async startRecording(): Promise<void> {
    if (this.status !== 'ready' && this.status !== 'speaking') return;

    // Generate new requestId for this user turn
    this.currentRequestId = generateId('req');
    this.responseComplete = false;

    // Stop any current playback
    this.player?.clear();
    if (isWebSpeechTTS(this.localTTS)) {
      this.localTTS.stop();
    }
    this.ttsQueue = [];
    this.localTTSActive = false;

    if (isWebSpeechSTT(this.localSTT)) {
      // Use browser speech recognition
      this.localSTT.start();
    } else if (this.localSTT) {
      // Use MediaRecorder for local STT pipeline
      await this.startMediaRecorder();
    } else if (this.recorder) {
      // Use audio recorder for server STT
      await this.recorder.start();
      this.send({ type: 'recording_start' });
    }

    this.setStatus('listening');
  }

  /**
   * Stop recording/listening and process
   */
  async stopRecording(): Promise<void> {
    if (this.status !== 'listening') return;

    if (isWebSpeechSTT(this.localSTT)) {
      // Stop browser speech recognition - fires onResult with final transcript
      this.localSTT.stop();
    } else if (this.localSTT) {
      // Stop MediaRecorder and process locally
      await this.stopMediaRecorder();
    } else if (this.recorder?.recording) {
      // Stop audio recorder and send to server
      await this.recorder.stop();
      this.setStatus('processing');
      this.send({ type: 'end_audio' });
    }
  }

  private async startMediaRecorder(): Promise<void> {
    this.mediaRecording = true;
    this.audioChunks = [];

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(stream);
    this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
    this.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      await this.processLocalAudio();
    };
    this.mediaRecorder.start();
  }

  private async stopMediaRecorder(): Promise<void> {
    if (!this.mediaRecording || !this.mediaRecorder) return;
    this.mediaRecording = false;
    this.mediaRecorder.stop();
  }

  private async processLocalAudio(): Promise<void> {
    this.setStatus('processing');
    const meta = createLocalMeta(this.currentRequestId);

    // Convert blob to Float32Array
    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    this.audioContext = this.audioContext || new AudioContext({ sampleRate: 16000 });
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    const audio = audioBuffer.getChannelData(0);

    // Transcribe locally
    if (!this.localSTT || isWebSpeechSTT(this.localSTT)) {
      this.emit('error', new Error('Local STT pipeline not available'), meta);
      this.setStatus('ready');
      return;
    }

    try {
      const transcript = await this.localSTT.transcribe(audio);
      if (!transcript.trim()) {
        this.setStatus('ready');
        return;
      }

      this.emit('transcript', transcript, meta);

      if (this.mode === 'local' || (this.mode === 'hybrid' && this.localLLM)) {
        // Process locally
        await this.processTextLocally(transcript, { skipTTS: !this.wantsTTS });
      } else {
        // Send to server
        this.send({ type: 'text', text: transcript });
      }
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)), meta);
      this.setStatus('ready');
    }
  }

  private async processTextLocally(text: string, options?: { skipTTS?: boolean }): Promise<void> {
    this.currentResponse = '';

    if (this.localPipeline) {
      await this.runLocalPipeline(text, options?.skipTTS);
    } else if (this.localLLM) {
      await this.runLocalLLM(text, options?.skipTTS);
    }
  }

  private async runLocalPipeline(text: string, skipTTS?: boolean): Promise<void> {
    if (!this.localPipeline) return;
    const meta = createLocalMeta(this.currentRequestId);

    // Initialize history if empty
    if (this.history.length === 0) {
      this.history = this.localPipeline.createInitialHistory();
    }

    const context = {
      history: this.history,
    };

    const callbacks = {
      onTranscript: (t: string) => this.emit('transcript', t, meta),
      onResponseChunk: (chunk: string) => {
        this.currentResponse += chunk;
        this.emit('responseChunk', chunk, meta);

        if (isWebSpeechTTS(this.localTTS) && !skipTTS) {
          this.handleLocalTTSChunk(chunk);
        }
      },
      onAudio: async (playable: AudioPlayable) => {
        if (!isWebSpeechTTS(this.localTTS) && !skipTTS) {
          this.setStatus('speaking');
          await playable.play();
        }
      },
      onComplete: () => {
        this.emit('responseComplete', this.currentResponse, meta);

        if (isWebSpeechTTS(this.localTTS) && !skipTTS) {
          this.flushLocalTTS();
        } else {
          this.setStatus('ready');
        }
      },
      onError: (err: Error) => {
        this.emit('error', err, meta);
        this.setStatus('ready');
      },
    };

    const backends = skipTTS ? { stt: null, llm: this.localLLM!, tts: null } : undefined;
    await this.localPipeline.processText(text, context, callbacks, backends);
  }

  private async runLocalLLM(text: string, skipTTS?: boolean): Promise<void> {
    if (!this.localLLM) return;
    const meta = createLocalMeta(this.currentRequestId);

    // Initialize history if empty
    if (this.history.length === 0) {
      this.history = [{ role: 'system' as const, content: this.config.systemPrompt }];
    }

    // Add user message to history
    this.history.push({ role: 'user' as const, content: text });

    try {
      const result = await this.localLLM.generate(this.history, {
        onToken: (token: string) => {
          this.currentResponse += token;
          this.emit('responseChunk', token, meta);

          if (isWebSpeechTTS(this.localTTS) && !skipTTS) {
            this.handleLocalTTSChunk(token);
          }
        },
      });

      // Add assistant response to history
      this.history.push({ role: 'assistant' as const, content: result.content });

      this.emit('responseComplete', result.content, meta);

      if (isWebSpeechTTS(this.localTTS) && !skipTTS) {
        await this.flushLocalTTS();
      } else {
        this.setStatus('ready');
      }
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)), meta);
      this.setStatus('ready');
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    // Reset local history
    if (this.localPipeline) {
      this.history = this.localPipeline.createInitialHistory();
    } else {
      this.history = [];
    }

    // Tell server to clear too
    if (this.needsServer) {
      // Generate a requestId for the clear_history message
      this.currentRequestId = generateId('req');
      this.send({ type: 'clear_history' });
    }
  }

  /**
   * Get current status
   */
  getStatus(): VoiceClientStatus {
    return this.status;
  }

  /**
   * Check if ready for interaction.
   * In server/hybrid mode, this requires both an open transport AND a valid session.
   */
  isReady(): boolean {
    if (this.mode === 'local') {
      return this.localPipeline?.isReady() ?? false;
    }
    return this.transport?.readyState === 'open' && this.sessionId !== null;
  }

  /**
   * Set whether client wants server to send TTS audio.
   * When false, server skips TTS (text-only responses). Sends updated capabilities if connected.
   */
  setWantsTTS(value: boolean): void {
    if (this.wantsTTS === value) return;
    this.wantsTTS = value;
    this.sendCapabilities();
  }

  /**
   * Whether client wants server to send TTS audio.
   */
  getWantsTTS(): boolean {
    return this.wantsTTS;
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    if (isWebSpeechSTT(this.localSTT)) {
      return this.localSTT.listening;
    }
    if (this.mediaRecording) return true;
    return this.recorder?.recording ?? false;
  }

  /**
   * Check if audio is currently being spoken (local TTS or server audio).
   * For server TTS, this returns true while playing OR waiting for the next audio chunk.
   */
  get isSpeaking(): boolean {
    return this.localTTSActive || (this.player?.playing ?? false) || this.status === 'speaking';
  }

  /**
   * Stop any current speech playback (local TTS or server audio)
   */
  stopSpeaking(): void {
    // Stop local TTS
    if (isWebSpeechTTS(this.localTTS)) {
      this.localTTS.stop();
    }
    this.ttsQueue = [];
    this.localTTSActive = false;

    // Stop server audio player
    this.player?.stop();

    // Mark response as complete since we're forcibly stopping
    this.responseComplete = true;

    if (this.status === 'speaking') {
      this.setStatus('ready');
    }
  }

  /**
   * Get current mode
   */
  getMode(): 'local' | 'remote' | 'hybrid' {
    return this.mode;
  }

  /**
   * Check which components are local
   */
  getLocalComponents(): { stt: boolean; llm: boolean; tts: boolean } {
    return {
      stt: this.localSTT !== null,
      llm: this.localLLM !== null,
      tts: this.localTTS !== null,
    };
  }

  /**
   * Get the current session ID (format: ses_<ulid>)
   * Returns null if not connected to a server
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get the current request ID (format: req_<ulid>)
   * Returns null if no request is in progress
   */
  getCurrentRequestId(): string | null {
    return this.currentRequestId;
  }

  /**
   * Get the underlying transport.
   * Useful for inspecting the transport state or for advanced use cases.
   * Returns null if not using server mode.
   */
  getTransport(): Transport | null {
    return this.transport;
  }

  /**
   * Get the underlying WebSocket connection.
   * Returns null if not using server mode, not connected, or not using WebSocket transport.
   *
   * @deprecated Use getTransport() instead for transport-agnostic code.
   *
   * @example
   * ```typescript
   * // Send a custom message
   * const envelope: ClientEnvelope = {
   *   sessionId: client.getSessionId()!,
   *   requestId: generateId('req'),
   *   message: { type: 'my_custom_message', data: {...} } as any,
   * };
   * client.getWebSocket()?.send(JSON.stringify(envelope));
   * ```
   */
  getWebSocket(): WebSocket | null {
    if (this.transport instanceof WebSocketTransport) {
      // WebSocketTransport doesn't expose the raw WS; return null
      // Users should migrate to getTransport()
      return null;
    }
    return null;
  }

  /**
   * Subscribe to events
   */
  on<K extends EventName>(event: K, callback: VoiceClientEvents[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback<EventName>);
  }

  /**
   * Unsubscribe from events
   */
  off<K extends EventName>(event: K, callback: VoiceClientEvents[K]): void {
    this.listeners.get(event)?.delete(callback as EventCallback<EventName>);
  }

  /**
   * Clean up all resources
   */
  async dispose(): Promise<void> {
    this.disconnect();
    await this.recorder?.dispose();
    this.player?.dispose();
    if (isWebSpeechSTT(this.localSTT)) {
      this.localSTT.dispose();
    }
    this.listeners.clear();
  }

  // ============ Private Methods ============

  private send(msg: ClientMessage): void {
    if (this.transport?.readyState === 'open' && this.sessionId && this.currentRequestId) {
      const envelope: ClientEnvelope = {
        sessionId: this.sessionId,
        requestId: this.currentRequestId,
        message: msg,
      };
      this.transport.send(envelope);
    }
  }

  private sendCapabilities(): void {
    if (this.transport?.readyState !== 'open' || !this.sessionId) return;
    const envelope: ClientEnvelope = {
      sessionId: this.sessionId,
      requestId: generateId('req'),
      message: {
        type: 'capabilities',
        hasSTT: this.localSTT !== null,
        hasTTS: this.localTTS !== null,
        wantsTTS: this.wantsTTS,
      },
    };
    this.transport.send(envelope);
  }

  private handleServerEnvelope(envelope: ServerEnvelope): void {
    const { message: msg, requestId, responseId } = envelope;
    const meta: EventMeta = { requestId: requestId ?? '', responseId };

    switch (msg.type) {
      case 'session_init':
        // Store session ID and send capabilities
        this.sessionId = msg.sessionId;
        this.sendCapabilities();
        this.setStatus('ready');
        break;

      case 'transcript':
        // Server did STT - only relevant if we're not using local STT
        if (!this.localSTT) {
          // New response starting - don't go to 'ready' until 'complete' received
          this.responseComplete = false;
          this.currentResponse = '';
          this.emit('transcript', msg.text, meta);
        }
        break;

      case 'response_chunk':
        // If this is the first chunk (e.g., server-initiated message), mark response as in progress
        if (this.responseComplete) {
          this.responseComplete = false;
        }
        this.currentResponse += msg.text;
        this.lastSkipTTS = msg.skipTTS ?? false;
        this.emit('responseChunk', msg.text, meta);

        // If using local TTS, queue text for speech (unless server signaled TTS was skipped)
        if (this.localTTS && !msg.skipTTS) {
          this.handleLocalTTSChunk(msg.text);
        }
        break;

      case 'audio':
        // Only process server audio if not using local TTS
        if (!this.localTTS && this.player) {
          const audio = base64ToFloat32(msg.data);
          this.player.enqueue(audio, msg.sampleRate);
        }
        break;

      case 'tool_call':
        this.emit('toolCall', {
          id: msg.toolCallId,
          name: msg.name,
          arguments: msg.arguments,
        }, meta);
        break;

      case 'tool_result':
        this.emit('toolResult', msg.toolCallId, msg.result, meta);
        break;

      case 'complete':
        this.responseComplete = true;
        this.emit('responseComplete', this.currentResponse, meta);

        if (this.localTTS && !this.lastSkipTTS) {
          this.flushLocalTTS();
        } else if (this.localTTS) {
          this.setStatus('ready');
        } else if (this.player) {
          // If audio already finished, go to ready now
          // Otherwise, onEnd callback will handle it
          if (!this.player.playing && this.player.queueLength === 0) {
            this.setStatus('ready');
          }
        } else {
          this.setStatus('ready');
        }
        this.lastSkipTTS = false;
        break;

      case 'error':
        this.emit('error', new Error(msg.message), meta);
        this.lastSkipTTS = false;
        this.setStatus('ready');
        break;
    }
  }


  private handleLocalTTSChunk(text: string): void {
    // Accumulate text and speak sentence by sentence
    this.pendingTTSText += text;

    // Check for sentence endings
    const sentenceEnders = /[.!?]/;
    const match = this.pendingTTSText.match(sentenceEnders);

    if (match && match.index !== undefined) {
      const sentence = this.pendingTTSText.slice(0, match.index + 1).trim();
      this.pendingTTSText = this.pendingTTSText.slice(match.index + 1);

      if (sentence) {
        this.ttsQueue.push(sentence);
        this.processLocalTTSQueue();
      }
    }
  }

  private flushLocalTTS(): void {
    // Speak any remaining text
    if (this.pendingTTSText.trim()) {
      this.ttsQueue.push(this.pendingTTSText.trim());
      this.pendingTTSText = '';
    }
    this.processLocalTTSQueue();
  }

  private async processLocalTTSQueue(): Promise<void> {
    if (this.localTTSActive || this.ttsQueue.length === 0 || !this.localTTS) return;

    this.localTTSActive = true;
    this.setStatus('speaking');

    while (this.ttsQueue.length > 0) {
      const text = this.ttsQueue.shift()!;
      try {
        if (isWebSpeechTTS(this.localTTS)) {
          await this.localTTS.speak(text);
        } else {
          // TTSPipeline - synthesize and play
          const playable = await this.localTTS.synthesize(text);
          await playable.play();
        }
      } catch {
        // Ignore TTS errors (e.g., if speech was cancelled)
      }
    }

    this.localTTSActive = false;
    if (this.status === 'speaking') {
      this.setStatus('ready');
    }
  }

  private setStatus(newStatus: VoiceClientStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.emit('status', newStatus);
    }
  }

  private emit<K extends EventName>(event: K, ...args: Parameters<VoiceClientEvents[K]>): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          (callback as (...args: Parameters<VoiceClientEvents[K]>) => void)(...args);
        } catch (err) {
          console.error(`Error in ${event} listener:`, err);
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.config.reconnectDelay);
  }

  private validateBrowserSupport(components: ClientComponents): void {
    const support = VoiceClient.getBrowserSupport();

    // Check WebSpeech STT if trying to use it
    if (components.stt instanceof WebSpeechSTT) {
      if (!support.webSpeechSTT) {
        throw new Error(
          'WebSpeech STT is not supported in this browser.\n\n' +
          'Options:\n' +
          '  1. Use Chrome, Edge, or Safari (they support Web Speech API)\n' +
          '  2. Use TransformersSTT for local transcription (works in all browsers with WebGPU)\n' +
          '  3. Use server-side STT by setting stt: null with a serverUrl\n\n' +
          'Example with TransformersSTT:\n' +
          '  import { TransformersSTT } from "modular-voice-agent-sdk";\n' +
          '  const client = new VoiceClient({ stt: new TransformersSTT({ model: "Xenova/whisper-tiny" }), ... })'
        );
      }
    }

    // Check WebSpeech TTS if trying to use it
    if (components.tts instanceof WebSpeechTTS) {
      if (!support.webSpeechTTS) {
        throw new Error(
          'WebSpeech TTS is not supported in this browser.\n\n' +
          'Options:\n' +
          '  1. Use a different browser (most modern browsers support speech synthesis)\n' +
          '  2. Use server-side TTS by setting tts: null with a serverUrl'
        );
      }
    }

    // Check MediaDevices for any STT (local or server)
    const needsMicrophone = components.stt !== undefined || components.stt === null;
    if (needsMicrophone && !support.mediaDevices) {
      throw new Error(
        'Microphone access (MediaDevices API) is not available.\n' +
        'This may be because:\n' +
        '  1. The page is not served over HTTPS\n' +
        '  2. The browser does not support getUserMedia\n' +
        '  3. Microphone permissions were denied'
      );
    }

    // Check WebSocket if using server with default transport (no custom transport)
    if (components.serverUrl && !components.transport && !support.webSocket) {
      throw new Error('WebSocket is not supported in this browser. Consider using a custom transport (e.g., HttpSseTransport).');
    }

    // Check AudioContext for audio processing
    if (!support.audioContext) {
      throw new Error(
        'AudioContext is not supported in this browser.\n' +
        'Audio processing requires a modern browser with Web Audio API support.'
      );
    }
  }
}

// ============ Factory Function ============

/**
 * Create a VoiceClient instance
 *
 * @example
 * ```typescript
 * // Fully local with Transformers
 * const client = createVoiceClient({
 *   create: (modelStore) => ({
 *     stt: new TransformersSTT({ model: '...' }, modelStore),
 *     llm: new TransformersLLM({ model: '...' }, modelStore),
 *     tts: new WebSpeechTTS(),
 *     systemPrompt: 'You are a helpful assistant.',
 *   }),
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Fully remote
 * const client = createVoiceClient({
 *   create: () => ({
 *     stt: null,
 *     llm: null,
 *     tts: null,
 *     serverUrl: 'ws://localhost:3000',
 *   }),
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Hybrid: local TTS, server STT/LLM
 * const client = createVoiceClient({
 *   create: () => ({
 *     stt: null,
 *     llm: null,
 *     tts: new WebSpeechTTS(),
 *     serverUrl: 'ws://localhost:3000',
 *   }),
 * });
 * ```
 */
export function createVoiceClient(config: VoiceClientConfig): VoiceClient {
  return new VoiceClient(config);
}
