/**
 * CloudAudioLLM - Multimodal Audio LLM Backend
 *
 * Implements BOTH STTPipeline and LLMPipeline interfaces.
 * Register the same instance as both `stt` and `llm` in VoicePipeline.
 *
 * Uses internal caching to achieve single API call:
 * 1. transcribe(audio) → calls multimodal API, caches response, returns transcript
 * 2. generate(messages) → returns cached response (no second API call)
 *
 * The model is prompted to return both transcription and response in a structured format.
 *
 * Works with: OpenAI GPT-4o-audio-preview, and other audio-capable OpenAI-compatible endpoints.
 */

import type {
  STTPipeline,
  LLMPipeline,
  CloudLLMConfig,
  ProgressCallback,
  Message,
  LLMGenerateOptions,
  LLMGenerateResult,
  ToolDefinition,
  ToolCall,
  ToolMessage,
  AssistantMessage,
} from '../../types';
import { LLMLogger, LLMConversationTracker, type TrackerMessage } from '../../services';

export interface CloudAudioLLMConfig extends CloudLLMConfig {
  /**
   * Format for audio encoding.
   * @default 'wav'
   */
  audioFormat?: 'wav' | 'mp3' | 'pcm16';
  /**
   * Sample rate for audio input.
   * @default 16000
   */
  sampleRate?: number;
}

interface CachedAudioResponse {
  transcript: string;
  result: LLMGenerateResult;
  audioHash: string;
}

export class CloudAudioLLM implements STTPipeline, LLMPipeline {
  private config: CloudAudioLLMConfig;
  private ready = false;
  private tracker: LLMConversationTracker;

  // Cached response from transcribe() - used by the immediate generate() call
  // This is instance-level because transcribe() doesn't know the conversationId yet
  // (VoicePipeline calls transcribe() before generate())
  private cachedResponse: CachedAudioResponse | null = null;

  // Per-conversation state for audio (keyed by conversationId for WebSocket isolation)
  // Used for tool follow-ups which need the original audio
  private conversationAudio: Map<string, string> = new Map();

  // Current conversation context (set by generate(), used by transcribe())
  private currentConversationId: string = 'default';
  private currentMessages: Message[] = [];
  private currentOptions: LLMGenerateOptions | undefined;

  constructor(config: CloudAudioLLMConfig) {
    this.config = {
      audioFormat: 'wav',
      sampleRate: 16000,
      ...config,
    };
    this.tracker = new LLMConversationTracker(new LLMLogger());
  }


  async initialize(_onProgress?: ProgressCallback): Promise<void> {
    console.log(`Initializing CloudAudioLLM (${this.config.baseUrl})...`);
    console.log(`  Model: ${this.config.model}`);
    console.log(`  Audio format: ${this.config.audioFormat}`);
    this.ready = true;
    console.log('CloudAudioLLM ready.');
  }

  isReady(): boolean {
    return this.ready;
  }

  supportsTools(): boolean {
    return true;
  }

  // ============================================================
  // STTPipeline Implementation
  // ============================================================

  /**
   * Transcribe audio by calling the multimodal API.
   * Caches the full response for the subsequent generate() call.
   */
  async transcribe(audio: Float32Array): Promise<string> {
    const audioHash = this.hashAudio(audio);

    // Check if we already processed this audio
    if (this.cachedResponse?.audioHash === audioHash) {
      return this.cachedResponse.transcript;
    }

    // Build messages with system prompt
    const messages = this.currentMessages.length > 0 ? this.currentMessages : [];

    // Process audio with multimodal API
    const { transcript, result } = await this.processAudioWithAPI(
      audio,
      messages,
      this.currentOptions
    );

    // Cache for subsequent generate() call
    this.cachedResponse = { transcript, result, audioHash };

    return transcript;
  }

  // ============================================================
  // LLMPipeline Implementation
  // ============================================================

  /**
   * Generate response. If called after transcribe() with matching context,
   * returns cached response (single API call total).
   */
  async generate(
    messages: Message[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    const conversationId = options?.conversationId ?? 'default';

    // Store context for potential audio processing (used by transcribe())
    this.currentConversationId = conversationId;
    this.currentMessages = messages;
    this.currentOptions = options;

    // Check if we have a cached response from transcribe()
    if (this.cachedResponse) {
      const cached = this.cachedResponse;
      this.cachedResponse = null; // Clear cache

      // Log input (messages now include the transcript as user message)
      this.tracker.logInput(conversationId, messages as TrackerMessage[]);

      // Stream the cached response if callback provided
      if (options?.onToken && cached.result.content) {
        for (const char of cached.result.content) {
          options.onToken(char);
        }
      }

      // Log output
      this.tracker.logOutput(
        conversationId,
        cached.result.content,
        cached.result.toolCalls
      );

      return cached.result;
    }

    // No cache - do standard text generation
    return this.textGenerate(messages, options);
  }

  // ============================================================
  // Internal: Audio Processing
  // ============================================================

  private async processAudioWithAPI(
    audio: Float32Array,
    messages: Message[],
    options?: LLMGenerateOptions
  ): Promise<{ transcript: string; result: LLMGenerateResult }> {
    // Encode audio to base64 and store for potential follow-up requests (tool results)
    const base64Audio = this.encodeAudioToBase64(audio);
    const conversationId = options?.conversationId ?? this.currentConversationId;
    this.conversationAudio.set(conversationId, base64Audio);

    // Build the multimodal request (pass tools to inject selection instruction)
    const hasTools = options?.tools && options.tools.length > 0;
    const openaiMessages = this.convertMessagesForAudio(messages, hasTools);

    // Add the audio input as a user message with transcript instruction
    // Parenthetical format works well - doesn't interfere with model understanding
    openaiMessages.push({
      role: 'user',
      content: [
        {
          type: 'input_audio',
          input_audio: {
            data: base64Audio,
            format: this.config.audioFormat,
          },
        },
        {
          type: 'text',
          text: 'Respond with JSON: {"transcript":"<what user said>","response":"<your response>"}',
        },
      ],
    });

    // Build request body
    // Note: Audio models don't support structured outputs, so we prompt for JSON format
    // Specify modalities to indicate we want text output (audio input is in the messages)
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: openaiMessages,
      modalities: ['text'],
      ...this.config.modelParams,
    };

    // Track if we expect JSON response (no tools = expect JSON)
    let expectJson = true;

    // Add tools if provided
    if (options?.tools && options.tools.length > 0) {
      body.tools = this.convertTools(options.tools);
      body.parallel_tool_calls = false; // Force sequential tool calls
      expectJson = false; // Model may return tool calls instead of JSON
    }

    // Note: Input logging happens in generate() when we have complete messages with transcript

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `CloudAudioLLM API error (${response.status}): ${errorText}`
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const toolCalls = this.extractToolCalls(data);

    // Parse the response based on format used
    const { transcript, responseText } = this.parseStructuredResponse(content, expectJson);

    const result: LLMGenerateResult = {
      content: responseText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };

    return { transcript, result };
  }

  /**
   * Parse the response based on format used
   * - JSON mode: {"transcript":"...","response":"..."}
   * - Tool mode: Plain text (model may go straight to tool call)
   */
  private parseStructuredResponse(
    content: string,
    expectJson: boolean
  ): {
    transcript: string;
    responseText: string;
  } {
    if (expectJson) {
      // Parse JSON response
      const parsed = JSON.parse(content);
      return {
        transcript: parsed.transcript,
        responseText: parsed.response,
      };
    }

    // Tool mode: content may be empty or brief (model went to tool call)
    // Just return whatever content we got
    return {
      transcript: '[audio processed]',
      responseText: content,
    };
  }

  // ============================================================
  // Internal: Text Generation (for non-audio turns)
  // ============================================================

  private async textGenerate(
    messages: Message[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    const conversationId = options?.conversationId ?? 'default';
    this.tracker.logInput(conversationId, messages as TrackerMessage[]);

    // Convert messages and inject stored audio (audio model requires audio in every request)
    const openaiMessages = this.convertMessagesWithAudio(messages, conversationId);

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: openaiMessages,
      modalities: ['text'],
      stream: !!options?.onToken,
      ...this.config.modelParams,
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = this.convertTools(options.tools);
      body.parallel_tool_calls = false; // Force sequential tool calls
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `CloudAudioLLM API error (${response.status}): ${errorText}`
      );
    }

    if (options?.onToken && response.body) {
      return this.handleStreamingResponse(
        response.body,
        options,
        conversationId
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const toolCalls = this.extractToolCalls(data);
    const finishReason = data.choices?.[0]?.finish_reason;

    // Check for empty response (no content and no tool calls)
    if (!content && toolCalls.length === 0) {
      const reason = finishReason || 'unknown';
      throw new Error(
        `CloudAudioLLM returned empty response (finish_reason: ${reason}). ` +
        (reason === 'length'
          ? 'The model hit the token limit before producing output. Try increasing max_completion_tokens.'
          : 'The model did not produce any content.')
      );
    }

    this.tracker.logOutput(
      conversationId,
      content,
      toolCalls.length > 0 ? toolCalls : undefined
    );

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  private async handleStreamingResponse(
    body: ReadableStream<Uint8Array>,
    options: LLMGenerateOptions,
    conversationId: string
  ): Promise<LLMGenerateResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    let finishReason: string | null = null;
    const toolCalls: Map<
      number,
      { id: string; name: string; arguments: string }
    > = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);

            // Check for API error in stream
            if (parsed.error) {
              throw new Error(`CloudAudioLLM stream error: ${JSON.stringify(parsed.error)}`);
            }

            const choice = parsed.choices?.[0];
            const delta = choice?.delta;

            if (delta?.content) {
              fullContent += delta.content;
              options.onToken?.(delta.content);
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;
                if (!toolCalls.has(index)) {
                  toolCalls.set(index, { id: '', name: '', arguments: '' });
                }
                const existing = toolCalls.get(index)!;
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments)
                  existing.arguments += tc.function.arguments;
              }
            }

            // Track finish reason from API
            if (choice?.finish_reason) {
              finishReason = choice.finish_reason;
            }
          } catch (e) {
            // Re-throw actual errors, only skip JSON parse errors
            if (e instanceof SyntaxError) {
              console.warn('CloudAudioLLM: Skipping malformed JSON line:', jsonStr.substring(0, 100));
            } else {
              throw e;
            }
          }
        }
      }
    }

    const resultToolCalls: ToolCall[] = [];
    for (const [, tc] of toolCalls) {
      if (tc.id && tc.name) {
        resultToolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: JSON.parse(tc.arguments || '{}'),
        });
      }
    }

    // Check for empty response (no content and no tool calls)
    if (!fullContent && resultToolCalls.length === 0) {
      const reason = finishReason || 'unknown';
      throw new Error(
        `CloudAudioLLM returned empty response (finish_reason: ${reason}). ` +
        (reason === 'length'
          ? 'The model hit the token limit before producing output. Try increasing max_completion_tokens.'
          : 'The model did not produce any content.')
      );
    }

    this.tracker.logOutput(
      conversationId,
      fullContent,
      resultToolCalls.length > 0 ? resultToolCalls : undefined
    );

    return {
      content: fullContent,
      toolCalls: resultToolCalls.length > 0 ? resultToolCalls : undefined,
      finishReason: resultToolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  // ============================================================
  // Internal: Helpers
  // ============================================================

  private hashAudio(audio: Float32Array): string {
    // Simple hash based on length and samples
    let hash = audio.length;
    const step = Math.max(1, Math.floor(audio.length / 100));
    for (let i = 0; i < audio.length; i += step) {
      hash = (hash << 5) - hash + Math.floor(audio[i] * 1000);
      hash |= 0;
    }
    return `audio-${audio.length}-${hash}`;
  }

  private encodeAudioToBase64(audio: Float32Array): string {
    // Convert Float32Array to 16-bit PCM WAV, then base64
    const numChannels = 1;
    const sampleRate = this.config.sampleRate!;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = audio.length * 2; // 16-bit = 2 bytes per sample
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Convert Float32 samples to Int16
    let offset = 44;
    for (let i = 0; i < audio.length; i++) {
      const sample = Math.max(-1, Math.min(1, audio[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }

    // Convert to base64
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private convertMessages(messages: Message[]): unknown[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        const toolMsg = m as ToolMessage;
        return {
          role: 'tool',
          content: toolMsg.content,
          tool_call_id: toolMsg.toolCallId,
        };
      }

      if (m.role === 'assistant') {
        const assistantMsg = m as AssistantMessage;
        if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
          return {
            role: 'assistant',
            content: assistantMsg.content || null,
            tool_calls: assistantMsg.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          };
        }
      }

      return { role: m.role, content: m.content };
    });
  }

  private convertMessagesForAudio(messages: Message[], hasTools: boolean = false): unknown[] {
    const converted = this.convertMessages(messages);

    // Add tool selection instruction to system prompt if tools are available
    if (hasTools && converted.length > 0) {
      const first = converted[0] as { role: string; content: string };
      if (first.role === 'system') {
        first.content = first.content + '\n\nOnly call ONE tool at a time. Wait for the result before deciding if another tool is needed.';
      }
    }

    return converted;
  }

  /**
   * Convert messages and inject stored audio into the first user message.
   * Audio models require audio in every request, so we include the original audio
   * from the conversation when processing tool results.
   */
  private convertMessagesWithAudio(messages: Message[], conversationId: string): unknown[] {
    const converted = this.convertMessages(messages);
    const lastAudioBase64 = this.conversationAudio.get(conversationId);

    // If we have stored audio, inject it into the first user message
    if (lastAudioBase64) {
      for (let i = 0; i < converted.length; i++) {
        const msg = converted[i] as { role: string; content: unknown };
        if (msg.role === 'user' && typeof msg.content === 'string') {
          // Replace text-only user message with audio + text
          converted[i] = {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: lastAudioBase64,
                  format: this.config.audioFormat,
                },
              },
              {
                type: 'text',
                text: msg.content,
              },
            ],
          };
          break; // Only inject into first user message
        }
      }
    }

    return converted;
  }

  private convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private extractToolCalls(data: unknown): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const message = (
      data as {
        choices?: Array<{
          message?: {
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      }
    )?.choices?.[0]?.message;

    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || '{}'),
        });
      }
    }

    return toolCalls;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }
}

