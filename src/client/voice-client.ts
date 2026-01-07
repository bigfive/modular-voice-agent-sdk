/**
 * Voice Client
 *
 * Unified browser SDK for voice assistants.
 * Handles three modes:
 * 1. Fully local - all components run in browser, no server needed
 * 2. Fully remote - all processing on server via WebSocket
 * 3. Hybrid - mix of local and server components
 *
 * Component logic:
 * - Component provided → runs locally
 * - Component is null + serverUrl → server handles it
 * - All components local → no WebSocket needed
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
  type ClientMessage,
  type ServerMessage,
} from './protocol';

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
}

export type VoiceClientStatus =
  | 'disconnected'
  | 'connecting'
  | 'initializing'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'speaking';

export interface VoiceClientConfig {
  /**
   * STT backend - runs locally in browser
   * - Provide an STTPipeline (e.g., TransformersSTT) or WebSpeechSTT for local STT
   * - Set to null to use server-side STT (requires serverUrl)
   * @default null (server handles)
   */
  stt?: STTPipeline | WebSpeechSTT | null;

  /**
   * LLM backend - runs locally in browser
   * - Provide an LLMPipeline (e.g., TransformersLLM) for local LLM
   * - Set to null to use server-side LLM (requires serverUrl)
   * @default null (server handles)
   */
  llm?: LLMPipeline | null;

  /**
   * TTS backend - runs locally in browser
   * - Provide a TTSPipeline (e.g., TransformersTTS) or WebSpeechTTS for local TTS
   * - Set to null to use server-side TTS (requires serverUrl)
   * @default null (server handles)
   */
  tts?: TTSPipeline | WebSpeechTTS | null;

  /**
   * System prompt for the LLM (required if llm is provided)
   */
  systemPrompt?: string;

  /**
   * WebSocket server URL (required if any component is null)
   */
  serverUrl?: string;

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
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface VoiceClientEvents {
  /** Connection/initialization status changed */
  status: (status: VoiceClientStatus) => void;
  /** User transcript received (from STT) */
  transcript: (text: string) => void;
  /** Assistant response chunk (streaming) */
  responseChunk: (text: string) => void;
  /** Full response complete */
  responseComplete: (fullText: string) => void;
  /** Tool call started (function calling) */
  toolCall: (toolCall: ToolCallInfo) => void;
  /** Tool call result received */
  toolResult: (toolCallId: string, result: unknown) => void;
  /** Error occurred */
  error: (error: Error) => void;
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

    return {
      webSpeechSTT: hasWindow && !!(
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition
      ),
      webSpeechTTS: hasWindow && 'speechSynthesis' in window,
      webGPU: hasWindow && 'gpu' in navigator,
      mediaDevices: hasWindow && !!(navigator.mediaDevices?.getUserMedia),
      webSocket: hasWindow && 'WebSocket' in window,
      audioContext: hasWindow && !!(
        (window as any).AudioContext ||
        (window as any).webkitAudioContext
      ),
    };
  }

  /**
   * Get a human-readable description of what's not supported.
   * Returns null if everything needed for basic operation is supported.
   */
  static getUnsupportedFeatures(): string[] {
    const support = VoiceClient.getBrowserSupport();
    const issues: string[] = [];

    if (!support.webSpeechSTT) {
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
    serverUrl?: string;
    systemPrompt: string;
  };

  // Mode detection
  private mode: 'local' | 'remote' | 'hybrid';
  private needsServer: boolean;

  // Local components
  private localSTT: STTPipeline | WebSpeechSTT | null = null;
  private localLLM: LLMPipeline | null = null;
  private localTTS: TTSPipeline | WebSpeechTTS | null = null;
  private localPipeline: VoicePipeline | null = null;

  // Remote/hybrid components
  private ws: WebSocket | null = null;
  private recorder: AudioRecorder | null = null;
  private player: AudioPlayer | null = null;

  // State
  private status: VoiceClientStatus = 'disconnected';
  private listeners = new Map<EventName, Set<EventCallback<EventName>>>();
  private currentResponse = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTTSText = '';
  private ttsQueue: string[] = [];
  private isSpeaking = false;

  // Conversation state (for local mode)
  private conversationId = this.generateConversationId();
  private history: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [];

  // Recording state for local pipeline
  private audioContext: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private mediaRecording = false;

  private generateConversationId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  constructor(config: VoiceClientConfig) {
    // Check browser support first
    this.validateBrowserSupport(config);

    // Determine what's local vs remote
    const hasLocalSTT = config.stt !== undefined && config.stt !== null;
    const hasLocalLLM = config.llm !== undefined && config.llm !== null;
    const hasLocalTTS = config.tts !== undefined && config.tts !== null;

    this.needsServer = !hasLocalSTT || !hasLocalLLM || !hasLocalTTS;

    if (!hasLocalSTT && !hasLocalLLM && !hasLocalTTS) {
      this.mode = 'remote';
    } else if (hasLocalSTT && hasLocalLLM && hasLocalTTS) {
      this.mode = 'local';
    } else {
      this.mode = 'hybrid';
    }

    // Validate config
    if (this.needsServer && !config.serverUrl) {
      throw new Error(
        'serverUrl is required when any component (stt, llm, tts) is null. ' +
        'Either provide all components for fully-local mode, or specify a serverUrl.'
      );
    }

    if (hasLocalLLM && !config.systemPrompt) {
      throw new Error('systemPrompt is required when using a local LLM');
    }

    this.config = {
      sampleRate: config.sampleRate ?? 16000,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 2000,
      serverUrl: config.serverUrl,
      systemPrompt: config.systemPrompt ?? '',
    };

    // Store local components
    if (hasLocalSTT) this.localSTT = config.stt!;
    if (hasLocalLLM) this.localLLM = config.llm!;
    if (hasLocalTTS) this.localTTS = config.tts!;

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
          if (this.status === 'speaking') {
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

      this.localPipeline = new VoicePipeline({
        stt: sttForPipeline,
        llm: this.localLLM!,
        tts: ttsForPipeline,
        systemPrompt: this.config.systemPrompt,
      });
    }
  }

  private setupWebSpeechSTT(): void {
    const webSpeechSTT = this.localSTT as WebSpeechSTT;

    webSpeechSTT.onResult((result) => {
      if (result.isFinal && result.transcript.trim()) {
        const text = result.transcript.trim();
        this.emit('transcript', text);

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
      this.emit('error', error);
      this.setStatus('ready');
    });
  }

  // ============ Public API ============

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
      await this.connectWebSocket();
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

    const promises: Promise<void>[] = [];

    // Initialize STT (if not WebSpeechSTT)
    if (this.localSTT && !isWebSpeechSTT(this.localSTT)) {
      promises.push(this.localSTT.initialize(progressCallback));
    }

    // Initialize LLM
    if (this.localLLM) {
      promises.push(this.localLLM.initialize(progressCallback));
    }

    // Initialize TTS (WebSpeechTTS needs initialize too)
    if (this.localTTS) {
      if (isWebSpeechTTS(this.localTTS)) {
        promises.push(this.localTTS.initialize());
      } else {
        promises.push(this.localTTS.initialize(progressCallback));
      }
    }

    // Initialize local pipeline if exists
    if (this.localPipeline) {
      promises.push(this.localPipeline.initialize(progressCallback));
    }

    await Promise.all(promises);
  }

  private async connectWebSocket(): Promise<void> {
    if (!this.config.serverUrl) return;
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.setStatus('connecting');
    this.ws = new WebSocket(this.config.serverUrl);

    this.ws.onopen = () => {
      // Send capabilities
      this.send({
        type: 'capabilities',
        hasSTT: this.localSTT !== null,
        hasTTS: this.localTTS !== null,
      });
      this.setStatus('ready');
    };

    this.ws.onclose = () => {
      this.setStatus('disconnected');
      if (this.config.autoReconnect && this.needsServer) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.emit('error', new Error('WebSocket error'));
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.handleServerMessage(msg);
      } catch {
        this.emit('error', new Error('Failed to parse server message'));
      }
    };
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
    this.ws?.close();
    this.ws = null;

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

    // Stop any current playback
    this.player?.clear();
    if (isWebSpeechTTS(this.localTTS)) {
      this.localTTS.stop();
    }
    this.ttsQueue = [];
    this.isSpeaking = false;

    if (isWebSpeechSTT(this.localSTT)) {
      // Use browser speech recognition
      this.localSTT.start();
    } else if (this.localSTT) {
      // Use MediaRecorder for local STT pipeline
      await this.startMediaRecorder();
    } else if (this.recorder) {
      // Use audio recorder for server STT
      await this.recorder.start();
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

    // Convert blob to Float32Array
    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    this.audioContext = this.audioContext || new AudioContext({ sampleRate: 16000 });
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    const audio = audioBuffer.getChannelData(0);

    // Transcribe locally
    if (!this.localSTT || isWebSpeechSTT(this.localSTT)) {
      this.emit('error', new Error('Local STT pipeline not available'));
      this.setStatus('ready');
      return;
    }

    try {
      const transcript = await this.localSTT.transcribe(audio);
      if (!transcript.trim()) {
        this.setStatus('ready');
        return;
      }

      this.emit('transcript', transcript);

      if (this.mode === 'local' || (this.mode === 'hybrid' && this.localLLM)) {
        // Process locally
        await this.processTextLocally(transcript);
      } else {
        // Send to server
        this.send({ type: 'text', text: transcript });
      }
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      this.setStatus('ready');
    }
  }

  private async processTextLocally(text: string): Promise<void> {
    this.currentResponse = '';

    if (this.localPipeline) {
      // Fully local with pipeline
      await this.runLocalPipeline(text);
    } else if (this.localLLM) {
      // Hybrid: local LLM, possibly local TTS
      await this.runLocalLLM(text);
    }
  }

  private async runLocalPipeline(text: string): Promise<void> {
    if (!this.localPipeline) return;

    // Initialize history if empty
    if (this.history.length === 0) {
      this.history = this.localPipeline.createInitialHistory();
    }

    const context = {
      conversationId: this.conversationId,
      history: this.history,
    };

    const callbacks = {
      onTranscript: (t: string) => this.emit('transcript', t),
      onResponseChunk: (chunk: string) => {
        this.currentResponse += chunk;
        this.emit('responseChunk', chunk);

        // If using WebSpeechTTS separately, queue text
        if (isWebSpeechTTS(this.localTTS)) {
          this.handleLocalTTSChunk(chunk);
        }
      },
      onAudio: async (playable: AudioPlayable) => {
        // If not using WebSpeechTTS, play the audio from pipeline
        if (!isWebSpeechTTS(this.localTTS)) {
          this.setStatus('speaking');
          await playable.play();
        }
      },
      onComplete: () => {
        this.emit('responseComplete', this.currentResponse);

        if (isWebSpeechTTS(this.localTTS)) {
          this.flushLocalTTS();
        } else {
          this.setStatus('ready');
        }
      },
      onError: (err: Error) => {
        this.emit('error', err);
        this.setStatus('ready');
      },
    };

    // processText mutates context.history with new messages
    await this.localPipeline.processText(text, context, callbacks);
  }

  private async runLocalLLM(text: string): Promise<void> {
    if (!this.localLLM) return;

    // Initialize history if empty
    if (this.history.length === 0) {
      this.history = [{ role: 'system' as const, content: this.config.systemPrompt }];
    }

    // Add user message to history
    this.history.push({ role: 'user' as const, content: text });

    try {
      const result = await this.localLLM.generate(this.history, {
        conversationId: this.conversationId,
        onToken: (token: string) => {
          this.currentResponse += token;
          this.emit('responseChunk', token);

          if (isWebSpeechTTS(this.localTTS)) {
            this.handleLocalTTSChunk(token);
          } else if (this.localTTS) {
            // For TTSPipeline, we'd need sentence-level TTS
            // This is simplified - in practice you'd want sentence buffering
          } else {
            // Server TTS - send text
            // Server should handle this based on capabilities
          }
        },
      });

      // Add assistant response to history
      this.history.push({ role: 'assistant' as const, content: result.content });

      this.emit('responseComplete', result.content);

      if (isWebSpeechTTS(this.localTTS)) {
        await this.flushLocalTTS();
      } else if (!this.localTTS && this.needsServer) {
        // Wait for server TTS
      } else {
        this.setStatus('ready');
      }
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      this.setStatus('ready');
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    // Reset local history
    this.conversationId = this.generateConversationId();
    if (this.localPipeline) {
      this.history = this.localPipeline.createInitialHistory();
    } else {
      this.history = [];
    }

    // Tell server to clear too
    if (this.needsServer) {
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
   * Check if ready for interaction
   */
  isReady(): boolean {
    if (this.mode === 'local') {
      return this.localPipeline?.isReady() ?? false;
    }
    return this.ws?.readyState === WebSocket.OPEN;
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
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'transcript':
        // Server did STT - only relevant if we're not using local STT
        if (!this.localSTT) {
          this.currentResponse = '';
          this.emit('transcript', msg.text);
        }
        break;

      case 'response_chunk':
        this.currentResponse += msg.text;
        this.emit('responseChunk', msg.text);

        // If using local TTS, queue text for speech
        if (this.localTTS) {
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
        });
        break;

      case 'tool_result':
        this.emit('toolResult', msg.toolCallId, msg.result);
        break;

      case 'complete':
        this.emit('responseComplete', this.currentResponse);

        if (this.localTTS) {
          // Flush any remaining TTS text
          this.flushLocalTTS();
        } else if (this.player) {
          // Status will change to 'ready' when audio finishes
          if (!this.player.playing && this.player.queueLength === 0) {
            this.setStatus('ready');
          }
        } else {
          this.setStatus('ready');
        }
        break;

      case 'error':
        this.emit('error', new Error(msg.message));
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
    if (this.isSpeaking || this.ttsQueue.length === 0 || !this.localTTS) return;

    this.isSpeaking = true;
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

    this.isSpeaking = false;
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

  private validateBrowserSupport(config: VoiceClientConfig): void {
    const support = VoiceClient.getBrowserSupport();

    // Check WebSpeech STT if trying to use it
    if (config.stt instanceof WebSpeechSTT) {
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
    if (config.tts instanceof WebSpeechTTS) {
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
    const needsMicrophone = config.stt !== undefined || config.stt === null;
    if (needsMicrophone && !support.mediaDevices) {
      throw new Error(
        'Microphone access (MediaDevices API) is not available.\n' +
        'This may be because:\n' +
        '  1. The page is not served over HTTPS\n' +
        '  2. The browser does not support getUserMedia\n' +
        '  3. Microphone permissions were denied'
      );
    }

    // Check WebSocket if using server
    if (config.serverUrl && !support.webSocket) {
      throw new Error('WebSocket is not supported in this browser.');
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
 * @example
 * // Fully local
 * const client = createVoiceClient({
 *   stt: new TransformersSTT({ model: '...' }),
 *   llm: new TransformersLLM({ model: '...' }),
 *   tts: new WebSpeechTTS(),
 *   systemPrompt: 'You are a helpful assistant.',
 * });
 *
 * @example
 * // Fully remote
 * const client = createVoiceClient({
 *   serverUrl: 'ws://localhost:3000',
 * });
 *
 * @example
 * // Hybrid: local STT/TTS, server LLM
 * const client = createVoiceClient({
 *   stt: new WebSpeechSTT(),
 *   tts: new WebSpeechTTS(),
 *   serverUrl: 'ws://localhost:3000',
 * });
 */
export function createVoiceClient(config: VoiceClientConfig): VoiceClient {
  return new VoiceClient(config);
}
