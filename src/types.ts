/**
 * Voice Pipeline Library - Type Definitions
 */

// ============ Tool Types ============

/**
 * JSON Schema for tool parameters
 */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
  }>;
  required?: string[];
}

/**
 * Tool definition - describes a callable function
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

/**
 * Registered tool with execute function
 */
export interface Tool extends ToolDefinition {
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/**
 * Tool call request from LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result of executing a tool
 */
export interface ToolResult {
  toolCallId: string;
  result: unknown;
  error?: string;
}

// ============ Message Types ============

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface BaseMessage {
  role: MessageRole;
  content: string;
}

export interface ToolMessage extends BaseMessage {
  role: 'tool';
  toolCallId: string;
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  toolCalls?: ToolCall[];
}

export type Message = BaseMessage | ToolMessage | AssistantMessage;

// ============ Audio Types ============

export interface AudioResult {
  audio: Float32Array;
  sampleRate: number;
}

/**
 * AudioPlayable - Uniform interface for TTS output
 * Allows backends to either provide raw audio data OR direct playback
 */
export interface AudioPlayable {
  /** Get raw audio data (null if backend doesn't support raw audio, e.g., Web Speech) */
  getRawAudio(): AudioResult | null;

  /** Play the audio - works uniformly across all backends */
  play(): Promise<void>;

  /** Stop playback */
  stop(): void;
}

/**
 * BufferedAudioPlayable - For backends that produce raw audio data
 * Used by: Native TTS, Transformers TTS
 */
export class BufferedAudioPlayable implements AudioPlayable {
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;

  constructor(
    private audio: Float32Array,
    private sampleRate: number
  ) {}

  getRawAudio(): AudioResult {
    return { audio: this.audio, sampleRate: this.sampleRate };
  }

  async play(): Promise<void> {
    if (this.audio.length === 0) return;

    // Create AudioContext on demand (handles browser autoplay policies)
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    }

    // Resume if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const audioBuffer = this.audioContext.createBuffer(1, this.audio.length, this.sampleRate);
    // Copy data to channel (create a standard Float32Array to satisfy TS)
    const channelData = audioBuffer.getChannelData(0);
    channelData.set(this.audio);

    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = audioBuffer;
    this.sourceNode.connect(this.audioContext.destination);

    return new Promise((resolve) => {
      this.sourceNode!.onended = () => resolve();
      this.sourceNode!.start();
    });
  }

  stop(): void {
    this.sourceNode?.stop();
    this.sourceNode = null;
  }
}

// ============ Progress Types ============

export interface ProgressInfo {
  status: 'initiate' | 'download' | 'progress' | 'done' | 'ready';
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export type ProgressCallback = (progress: ProgressInfo) => void;

// ============ Pipeline Interfaces ============

export interface STTPipeline {
  initialize(onProgress?: ProgressCallback): Promise<void>;
  transcribe(audio: Float32Array): Promise<string>;
  isReady(): boolean;
}

/**
 * LLM generation options
 */
export interface LLMGenerateOptions {
  /** Tools available for the LLM to call */
  tools?: ToolDefinition[];
  /** Callback for streaming tokens */
  onToken?: (token: string) => void;
  /** Callback when tool calls are detected */
  onToolCall?: (toolCall: ToolCall) => void;
  /** Conversation ID for tracking/logging (supports multiple simultaneous conversations) */
  conversationId?: string;
}

/**
 * LLM generation result
 */
export interface LLMGenerateResult {
  /** Text content of the response */
  content: string;
  /** Tool calls requested by the LLM (if any) */
  toolCalls?: ToolCall[];
  /** Whether the response is complete or waiting for tool results */
  finishReason: 'stop' | 'tool_calls';
}

export interface LLMPipeline {
  initialize(onProgress?: ProgressCallback): Promise<void>;
  /**
   * Generate a response from the LLM
   * @param messages - Conversation history
   * @param options - Generation options including tools and callbacks
   * @returns Generation result with content and optional tool calls
   */
  generate(messages: Message[], options?: LLMGenerateOptions): Promise<LLMGenerateResult>;
  /** @deprecated Use generate() with options.onToken instead */
  generateLegacy?(messages: Message[], onToken: (token: string) => void): Promise<string>;
  isReady(): boolean;
  /** Whether this backend supports native tool calling */
  supportsTools?(): boolean;
}

export interface TTSPipeline {
  initialize(onProgress?: ProgressCallback): Promise<void>;
  synthesize(text: string): Promise<AudioPlayable>;
  isReady(): boolean;
}

// ============ Backend Config Types ============

export interface TransformersSTTConfig {
  model: string;
  dtype: string;
  language?: string;
  device?: 'webgpu' | 'cpu';
}

export interface TransformersLLMConfig {
  model: string;
  dtype: string;
  maxNewTokens: number;
  temperature: number;
  device?: 'webgpu' | 'cpu';
}

export interface TransformersTTSConfig {
  model: string;
  dtype: string;
  speakerEmbeddings: string;
  device?: 'webgpu' | 'cpu';
}

export interface NativeSTTConfig {
  binaryPath: string;
  modelPath: string;
  language: string;
}

export interface NativeLLMConfig {
  binaryPath: string;
  modelPath: string;
  maxNewTokens: number;
  temperature: number;
  gpuLayers?: number;
}

export interface NativeTTSConfig {
  binaryPath: string;
  modelPath: string;
}

export interface SherpaOnnxTTSConfig {
  binaryPath: string;
  modelDir: string;  // Directory containing .onnx, tokens.txt, espeak-ng-data/
  speakerId?: number;
  speedScale?: number;
}

export interface CloudLLMConfig {
  baseUrl: string;           // API base URL (e.g., "https://api.openai.com/v1" or "http://localhost:11434/v1")
  apiKey?: string;           // API key (optional for local servers like Ollama)
  model: string;             // Model name (e.g., "gpt-4o", "llama3.2")
  modelParams?: Record<string, unknown>;  // Model-specific params passed to API (e.g., max_tokens, temperature)
}

