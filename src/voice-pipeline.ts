/**
 * Voice Pipeline
 * Main orchestrator: STT → LLM → TTS
 *
 * STT and TTS are optional - omit them if the client handles them locally.
 * Supports tool registration for function calling with any LLM backend.
 *
 * The pipeline is stateless - callers manage conversation history via ConversationContext.
 */

import type {
  STTPipeline,
  LLMPipeline,
  TTSPipeline,
  Message,
  ProgressCallback,
  AudioPlayable,
  Tool,
  ToolDefinition,
  ToolCall,
  AssistantMessage,
  ToolMessage,
  TurnContext,
} from './types';
import { TextNormalizer } from './services/text-normalizer';

/** Maximum number of tool call iterations to prevent infinite loops */
const MAX_TOOL_ITERATIONS = 10;

/** Default filler phrases while executing tools */
const DEFAULT_TOOL_FILLER_PHRASES = [
  'Let me check that for you.',
  'One moment please.',
  'Let me look that up.',
];

/** Factory function that creates a backend instance */
export type BackendFactory<T> = () => T;

export interface VoicePipelineConfig {
  /** STT backend factory (optional if client does local STT) */
  stt?: BackendFactory<STTPipeline> | null;
  /** LLM backend factory (required) */
  llm: BackendFactory<LLMPipeline>;
  /** TTS backend factory (optional if client does local TTS) */
  tts?: BackendFactory<TTSPipeline> | null;
  /** System prompt for the LLM */
  systemPrompt: string;
  /** Registered tools for function calling */
  tools?: Tool[];
  /**
   * Filler phrases to say while executing tools.
   * Set to empty array to disable filler phrases.
   * @default ["Let me check that for you.", "One moment please.", "Let me look that up."]
   */
  toolFillerPhrases?: string[];
}

export interface VoicePipelineCallbacks {
  onTranscript: (text: string) => void;
  onResponseChunk: (text: string) => void;
  onAudio: (playable: AudioPlayable) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  /** Called when a tool is being executed */
  onToolCall?: (toolCall: ToolCall) => void;
  /** Called when a tool execution completes */
  onToolResult?: (toolCallId: string, result: unknown) => void;
}

/**
 * Conversation context - callers manage history externally
 */
export interface ConversationContext {
  /** Conversation history (managed by caller) */
  history: Message[];
}

/**
 * Session backends - per-session instances created from factories
 */
export interface SessionBackends {
  stt: STTPipeline | null;
  llm: LLMPipeline;
  tts: TTSPipeline | null;
}

export class VoicePipeline {
  // Factories for creating per-session instances
  private sttFactory: BackendFactory<STTPipeline> | null;
  private llmFactory: BackendFactory<LLMPipeline>;
  private ttsFactory: BackendFactory<TTSPipeline> | null;

  // Internal backends for pipeline's own use (e.g., local/browser mode)
  private stt: STTPipeline | null = null;
  private llm: LLMPipeline | null = null;
  private tts: TTSPipeline | null = null;

  private systemPrompt: string;
  private textNormalizer = new TextNormalizer();
  private tools: Map<string, Tool> = new Map();
  private toolDefinitions: ToolDefinition[] = [];
  private toolFillerPhrases: string[];
  private fillerPhraseIndex = 0;

  // Track if cache has been warmed
  private initialized = false;

  constructor(config: VoicePipelineConfig) {
    this.sttFactory = config.stt ?? null;
    this.llmFactory = config.llm;
    this.ttsFactory = config.tts ?? null;
    this.systemPrompt = config.systemPrompt;
    this.toolFillerPhrases = config.toolFillerPhrases ?? DEFAULT_TOOL_FILLER_PHRASES;

    // Register tools
    if (config.tools) {
      for (const tool of config.tools) {
        this.registerTool(tool);
      }
    }
  }

  /**
   * Register a tool for function calling
   */
  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
    this.toolDefinitions.push({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): void {
    this.tools.delete(name);
    this.toolDefinitions = this.toolDefinitions.filter(t => t.name !== name);
  }

  /**
   * Get registered tools
   */
  getTools(): ToolDefinition[] {
    return [...this.toolDefinitions];
  }

  /**
   * Get the system prompt (for initializing conversation history)
   */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /**
   * Create initial history with system prompt
   */
  createInitialHistory(): Message[] {
    return [{ role: 'system', content: this.systemPrompt }];
  }

  /**
   * Initialize the pipeline by warming the model cache.
   * Creates instances and initializes them, which loads models into cache.
   * These instances are also stored for the pipeline's own use (local/browser mode).
   * Subsequent session instances will initialize instantly from cache.
   */
  async initialize(onProgress?: ProgressCallback): Promise<void> {
    // Create instances - these warm the cache and are kept for pipeline's own use
    // Handle special case: if stt and llm use the same factory (e.g., CloudAudioLLM),
    // create one instance and use it for both
    if (this.hasSameSTTAndLLM()) {
      const sharedInstance = this.llmFactory();
      this.stt = sharedInstance as unknown as STTPipeline;
      this.llm = sharedInstance;
    } else {
      this.stt = this.sttFactory?.() ?? null;
      this.llm = this.llmFactory();
    }
    this.tts = this.ttsFactory?.() ?? null;

    const promises: Promise<void>[] = [this.llm.initialize(onProgress)];

    // Only initialize STT separately if it's a different instance
    if (this.stt && !this.hasSameSTTAndLLM()) {
      promises.push(this.stt.initialize(onProgress));
    }
    if (this.tts) {
      promises.push(this.tts.initialize(onProgress));
    }

    await Promise.all(promises);
    this.initialized = true;
  }

  /**
   * Check if the pipeline has been initialized (cache warmed).
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Create per-session backend instances.
   * Call this when a new session (e.g., WebSocket connection) starts.
   * Returns initialized backends ready for use.
   */
  async createSessionBackends(): Promise<SessionBackends> {
    if (!this.initialized) {
      throw new Error('VoicePipeline not initialized. Call initialize() first.');
    }

    // Create fresh instances for this session
    // Handle special case: if stt and llm use the same factory, share the instance
    let stt: STTPipeline | null;
    let llm: LLMPipeline;

    if (this.hasSameSTTAndLLM()) {
      const sharedInstance = this.llmFactory();
      stt = sharedInstance as unknown as STTPipeline;
      llm = sharedInstance;
    } else {
      stt = this.sttFactory?.() ?? null;
      llm = this.llmFactory();
    }
    const tts = this.ttsFactory?.() ?? null;

    // Initialize (fast - uses cache)
    const promises: Promise<void>[] = [llm.initialize()];
    // Only initialize STT separately if it's a different instance
    if (stt && !this.hasSameSTTAndLLM()) {
      promises.push(stt.initialize());
    }
    if (tts) promises.push(tts.initialize());
    await Promise.all(promises);

    return { stt, llm, tts };
  }

  /**
   * Check if this pipeline has the same factory for STT and LLM.
   * Used by handlers to detect CloudAudioLLM pattern where one instance serves both roles.
   */
  hasSameSTTAndLLM(): boolean {
    return this.sttFactory !== null && (this.sttFactory as unknown) === (this.llmFactory as unknown);
  }

  /**
   * Check if pipeline has STT configured
   */
  hasSTT(): boolean {
    return this.sttFactory !== null;
  }

  /**
   * Check if pipeline has TTS configured
   */
  hasTTS(): boolean {
    return this.ttsFactory !== null;
  }

  /**
   * Process text input through LLM (and optionally TTS)
   * Returns new messages to append to history
   * @param backends - Optional per-session backends. If not provided, uses pipeline's internal backends.
   */
  async processText(
    text: string,
    context: ConversationContext,
    callbacks: Omit<VoicePipelineCallbacks, 'onTranscript'>,
    backends?: SessionBackends
  ): Promise<Message[]> {
    const llm = backends?.llm ?? this.llm;
    const tts = backends?.tts ?? this.tts;

    if (!llm) {
      callbacks.onError(new Error('Pipeline not initialized. Call initialize() first.'));
      return [];
    }

    try {
      // Create a fresh TurnContext for this turn
      const turn = this.createTurnContext(context);

      const newMessages = await this.processTranscript(text, context, {
        ...callbacks,
        onTranscript: () => {},
      }, llm, tts, turn);
      callbacks.onComplete();
      return newMessages;
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  /**
   * Create a TurnContext for a single turn through the pipeline
   */
  private createTurnContext(context: ConversationContext): TurnContext {
    return {
      history: context.history,
      tools: this.toolDefinitions.length > 0 ? this.toolDefinitions : undefined,
    };
  }

  /**
   * Process audio input through STT → LLM → TTS
   * Returns new messages to append to history
   * @param backends - Optional per-session backends. If not provided, uses pipeline's internal backends.
   */
  async processAudio(
    audio: Float32Array,
    context: ConversationContext,
    callbacks: VoicePipelineCallbacks,
    backends?: SessionBackends
  ): Promise<Message[]> {
    const stt = backends?.stt ?? this.stt;
    const llm = backends?.llm ?? this.llm;
    const tts = backends?.tts ?? this.tts;

    if (!this.sttFactory) {
      callbacks.onError(new Error('No STT backend configured. Use processText() instead.'));
      return [];
    }
    if (!stt || !llm) {
      callbacks.onError(new Error('Pipeline not initialized. Call initialize() first.'));
      return [];
    }

    try {
      // Create a fresh TurnContext for this turn
      const turn = this.createTurnContext(context);

      const transcript = await stt.transcribe(audio, turn);
      if (!transcript.trim()) {
        callbacks.onError(new Error('Could not transcribe audio'));
        return [];
      }
      callbacks.onTranscript(transcript);

      const newMessages = await this.processTranscript(transcript, context, callbacks, llm, tts, turn);
      callbacks.onComplete();
      return newMessages;
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  /**
   * Internal: Process transcript through LLM
   */
  private async processTranscript(
    transcript: string,
    context: ConversationContext,
    callbacks: VoicePipelineCallbacks,
    llm: LLMPipeline,
    tts: TTSPipeline | null,
    turn?: TurnContext
  ): Promise<Message[]> {
    const newMessages: Message[] = [];

    // Add user message to context history
    const userMessage: Message = { role: 'user', content: transcript };
    context.history.push(userMessage);
    newMessages.push(userMessage);

    // Generate response with context
    const responseMessages = await this.generateResponse(context, callbacks, llm, tts, turn);
    newMessages.push(...responseMessages);

    return newMessages;
  }

  /**
   * Internal: Generate LLM response (with tool loop)
   */
  private async generateResponse(
    context: ConversationContext,
    callbacks: VoicePipelineCallbacks,
    llm: LLMPipeline,
    tts: TTSPipeline | null,
    turn?: TurnContext
  ): Promise<Message[]> {
    const newMessages: Message[] = [];
    const useNativeTools = (llm.supportsTools?.() ?? false) && this.toolDefinitions.length > 0;
    const hasTools = this.toolDefinitions.length > 0;

    // Tool execution loop
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const isToolCheckTurn = hasTools && iteration === 0;
      // Native tools now support streaming (via <text_response> format)
      // So we can stream whenever it's appropriate
      const shouldStream = !isToolCheckTurn || useNativeTools;

      const result = await this.generateLLMResponse(
        context,
        callbacks,
        useNativeTools,
        shouldStream,  // Enable streaming for native tools too
        llm,
        tts,
        turn
      );

      const toolCalls = useNativeTools
        ? result.toolCalls
        : this.parsePromptBasedToolCalls(result.content);

      if (!toolCalls || toolCalls.length === 0) {
        // Only call streamResponse if we didn't stream during generation
        // Native tools stream during generation, so skip here
        if (!shouldStream) {
          await this.streamResponse(result.content, callbacks, tts);
        }

        const assistantMsg: Message = { role: 'assistant', content: result.content };
        context.history.push(assistantMsg);
        newMessages.push(assistantMsg);
        return newMessages;
      }

      // Tool call - say filler phrase
      if (this.toolFillerPhrases.length > 0) {
        const fillerPhrase = this.toolFillerPhrases[this.fillerPhraseIndex % this.toolFillerPhrases.length];
        this.fillerPhraseIndex++;
        await this.streamResponse(fillerPhrase + ' ', callbacks, tts);
      }

      const assistantContent = useNativeTools ? result.content : '';
      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: assistantContent,
        toolCalls,
      };
      context.history.push(assistantMsg);
      newMessages.push(assistantMsg);

      // Execute tools
      for (const toolCall of toolCalls) {
        callbacks.onToolCall?.(toolCall);

        const tool = this.tools.get(toolCall.name);
        if (!tool) {
          const errorMsg: ToolMessage = {
            role: 'tool',
            toolCallId: toolCall.id,
            content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
          };
          context.history.push(errorMsg);
          newMessages.push(errorMsg);
          callbacks.onToolResult?.(toolCall.id, { error: `Unknown tool: ${toolCall.name}` });
          continue;
        }

        try {
          const toolResult = await tool.execute(toolCall.arguments);
          const resultMsg: ToolMessage = {
            role: 'tool',
            toolCallId: toolCall.id,
            content: JSON.stringify(toolResult),
          };
          context.history.push(resultMsg);
          newMessages.push(resultMsg);
          callbacks.onToolResult?.(toolCall.id, toolResult);
        } catch (error) {
          const errorResult = { error: error instanceof Error ? error.message : String(error) };
          const errorMsg: ToolMessage = {
            role: 'tool',
            toolCallId: toolCall.id,
            content: JSON.stringify(errorResult),
          };
          context.history.push(errorMsg);
          newMessages.push(errorMsg);
          callbacks.onToolResult?.(toolCall.id, errorResult);
        }
      }
    }

    console.warn('VoicePipeline: Max tool iterations reached');
    return newMessages;
  }

  /**
   * Stream a response to the client with optional TTS
   */
  private async streamResponse(content: string, callbacks: VoicePipelineCallbacks, tts: TTSPipeline | null): Promise<void> {
    if (!content) return;

    // Stream text chunks
    callbacks.onResponseChunk(content);

    // TTS if available
    if (tts) {
      const normalizedText = this.textNormalizer.normalize(content);
      if (normalizedText) {
        const playable = await tts.synthesize(normalizedText);
        callbacks.onAudio(playable);
      }
    }
  }

  /**
   * Generate LLM response
   */
  private async generateLLMResponse(
    context: ConversationContext,
    callbacks: VoicePipelineCallbacks,
    useNativeTools: boolean,
    shouldStream: boolean,
    llm: LLMPipeline,
    tts: TTSPipeline | null,
    turn?: TurnContext
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const tools = this.toolDefinitions.length > 0 ? this.toolDefinitions : undefined;

    if (shouldStream && tts) {
      return this.generateWithStreamingTTS(context, callbacks, useNativeTools, llm, tts, turn);
    }

    if (shouldStream) {
      const result = await llm.generate(context.history, {
        tools,
        onToken: (token) => callbacks.onResponseChunk(token),
        turn,
      });
      return { content: result.content, toolCalls: result.toolCalls };
    }

    const result = await llm.generate(context.history, {
      tools,
      turn,
    });
    return { content: result.content, toolCalls: result.toolCalls };
  }

  /**
   * Generate with streaming TTS (sentence by sentence)
   */
  private async generateWithStreamingTTS(
    context: ConversationContext,
    callbacks: VoicePipelineCallbacks,
    _useNativeTools: boolean,
    llm: LLMPipeline,
    tts: TTSPipeline,
    turn?: TurnContext
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const tools = this.toolDefinitions.length > 0 ? this.toolDefinitions : undefined;
    let sentenceBuffer = '';
    const sentenceEnders = /[.!?]/;
    const playableQueue = new Map<number, AudioPlayable>();
    let nextSentenceIndex = 0;
    let nextToSend = 0;
    const ttsPromises: Promise<void>[] = [];

    const flushPlayableQueue = () => {
      while (playableQueue.has(nextToSend)) {
        const playable = playableQueue.get(nextToSend)!;
        callbacks.onAudio(playable);
        playableQueue.delete(nextToSend);
        nextToSend++;
      }
    };

    const queueTTS = (sentence: string, index: number) => {
      const normalizedText = this.textNormalizer.normalize(sentence);
      const promise = tts
        .synthesize(normalizedText)
        .then((playable) => {
          playableQueue.set(index, playable);
          flushPlayableQueue();
        })
        .catch(() => {
          nextToSend = Math.max(nextToSend, index + 1);
          flushPlayableQueue();
        });
      ttsPromises.push(promise);
    };

    const result = await llm.generate(context.history, {
      tools,
      turn,
      onToken: (token) => {
        callbacks.onResponseChunk(token);
        sentenceBuffer += token;

        const match = sentenceBuffer.match(sentenceEnders);
        if (match && match.index !== undefined) {
          const sentence = sentenceBuffer.slice(0, match.index + 1).trim();
          sentenceBuffer = sentenceBuffer.slice(match.index + 1);
          if (sentence) {
            queueTTS(sentence, nextSentenceIndex++);
          }
        }
      },
    });

    if (sentenceBuffer.trim()) {
      queueTTS(sentenceBuffer.trim(), nextSentenceIndex++);
    }

    if (ttsPromises.length > 0) {
      await Promise.all(ttsPromises);
    }

    return { content: result.content, toolCalls: result.toolCalls };
  }

  /**
   * Parse tool calls from LLM output (for non-native tool backends)
   */
  private parsePromptBasedToolCalls(content: string): ToolCall[] | undefined {
    if (this.toolDefinitions.length === 0) {
      return undefined;
    }

    // Check if the content looks like a tool call (starts with { and contains "tool_call")
    const trimmed = content.trim();
    if (!trimmed.startsWith('{') || !trimmed.includes('"tool_call"')) {
      return undefined;
    }

    // Try to parse the entire content as a tool call JSON
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.tool_call?.name) {
        return [{
          id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name: parsed.tool_call.name,
          arguments: parsed.tool_call.arguments || {},
        }];
      }
    } catch {
      // Not valid JSON, try to extract tool call with regex
    }

    // Fallback: try to extract JSON object from content
    // This handles cases where there's extra text around the JSON
    const jsonMatch = content.match(/\{[\s\S]*"tool_call"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.tool_call?.name) {
          return [{
            id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name: parsed.tool_call.name,
            arguments: parsed.tool_call.arguments || {},
          }];
        }
      } catch {
        // Skip malformed JSON
      }
    }

    return undefined;
  }
}
