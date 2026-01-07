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
  TurnContext,
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

export class CloudAudioLLM implements STTPipeline, LLMPipeline {
  private config: CloudAudioLLMConfig;
  private ready = false;
  private tracker: LLMConversationTracker;

  // Last audio from this session - used for tool follow-ups (audio model requires audio in every request)
  private lastAudio: string | null = null;

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
   * Sets both sttResult and llmResult in TurnContext for the subsequent generate() call.
   */
  async transcribe(audio: Float32Array, turn?: TurnContext): Promise<string> {
    if (!turn) {
      throw new Error('CloudAudioLLM.transcribe() requires TurnContext. Pass turn parameter.');
    }

    if (turn.sttResult) {
      return turn.sttResult.transcript;
    }

    const { transcript, result } = await this.callAPI(turn.history, { tools: turn.tools }, audio);

    turn.sttResult = { transcript };
    turn.llmResult = result;

    return transcript;
  }

  // ============================================================
  // LLMPipeline Implementation
  // ============================================================

  /**
   * Generate response.
   * - Tool followup: Makes fresh API call with tool results
   * - User request: Returns cached result from transcribe()
   */
  async generate(
    messages: Message[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    const turn = options?.turn;

    // Primary branch: Is this a tool followup?
    const lastMessage = messages[messages.length - 1];
    const isToolFollowup = lastMessage?.role === 'tool';

    if (isToolFollowup) {
      // Tool followup: fresh API call with tool results
      const { result } = await this.callAPI(messages, options);

      if (options?.onToken && result.content) {
        for (const char of result.content) {
          options.onToken(char);
        }
      }

      return result;
    }

    // User request: validate cached result exists
    if (!turn?.llmResult) {
      throw new Error(
        'CloudAudioLLM.generate() called for user request without cached result. ' +
        'Call transcribe() first, or check if this should be a tool followup.'
      );
    }

    // Use cached result from transcribe()
    const result = turn.llmResult;

    this.tracker.logInput(messages as TrackerMessage[]);

    if (options?.onToken && result.content) {
      for (const char of result.content) {
        options.onToken(char);
      }
    }

    this.tracker.logOutput(result.content, result.toolCalls);
    return result;
  }

  // ============================================================
  // Internal: Unified API Call
  // ============================================================

  /**
   * Make API call to the audio model.
   *
   * @param messages - Conversation history
   * @param options - Generation options (tools, etc.)
   * @param freshAudio - If provided, this is an audio turn (transcribe + respond).
   *                     If not provided, this is a text turn (use stored lastAudio).
   */
  private async callAPI(
    messages: Message[],
    options?: LLMGenerateOptions,
    freshAudio?: Float32Array
  ): Promise<{ transcript: string; result: LLMGenerateResult }> {
    const isAudioTurn = !!freshAudio;
    const hasTools = !!(options?.tools && options.tools.length > 0);

    const openaiMessages = this.buildMessages(messages, hasTools, freshAudio);

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: openaiMessages,
      modalities: ['text'],
      ...this.config.modelParams,
    };

    if (hasTools) {
      body.tools = this.convertTools(options!.tools!);
      body.parallel_tool_calls = false;
    }

    if (!isAudioTurn) {
      this.tracker.logInput(messages as TrackerMessage[]);
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
      throw new Error(`CloudAudioLLM API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    const toolCalls = this.extractToolCalls(data);
    const finishReason = data.choices?.[0]?.finish_reason;

    if (!rawContent && toolCalls.length === 0) {
      const reason = finishReason || 'unknown';
      throw new Error(
        `CloudAudioLLM returned empty response (finish_reason: ${reason}). ` +
          (reason === 'length'
            ? 'The model hit the token limit before producing output. Try increasing max_completion_tokens.'
            : 'The model did not produce any content.')
      );
    }

    const { transcript, responseText } = this.parseResponse(rawContent, isAudioTurn, toolCalls.length > 0);

    if (!isAudioTurn) {
      this.tracker.logOutput(responseText, toolCalls.length > 0 ? toolCalls : undefined);
    }

    const result: LLMGenerateResult = {
      content: responseText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };

    return { transcript, result };
  }

  /**
   * Build messages for the API call.
   */
  private buildMessages(messages: Message[], hasTools: boolean, freshAudio?: Float32Array): unknown[] {
    const converted = this.convertMessages(messages);

    // Add tool instruction to system prompt if tools are available
    if (hasTools && converted.length > 0) {
      const first = converted[0] as { role: string; content: string };
      if (first.role === 'system') {
        first.content += '\n\nOnly call ONE tool at a time. Wait for the result before deciding if another tool is needed.';
      }
    }

    if (freshAudio) {
      // Audio turn: encode and store audio, add multimodal user message
      const base64Audio = this.encodeAudioToBase64(freshAudio);
      this.lastAudio = base64Audio;

      converted.push({
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
    } else {
      // Text turn: inject stored audio into last user message, add JSON instruction
      if (this.lastAudio) {
        for (let i = converted.length - 1; i >= 0; i--) {
          const msg = converted[i] as { role: string; content: unknown };
          if (msg.role === 'user' && typeof msg.content === 'string') {
            converted[i] = {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    data: this.lastAudio,
                    format: this.config.audioFormat,
                  },
                },
                {
                  type: 'text',
                  text: msg.content,
                },
              ],
            };
            break;
          }
        }
      }

      converted.push({
        role: 'user',
        content: 'Respond to the user\'s request with JSON: {"response":"<your response>"}',
      });
    }

    return converted;
  }

  /**
   * Parse API response. Handles both audio turn format {transcript, response}
   * and text turn format {response}.
   */
  private parseResponse(
    content: string,
    isAudioTurn: boolean,
    hasToolCalls: boolean
  ): { transcript: string; responseText: string } {
    if (content) {
      try {
        const parsed = JSON.parse(content);

        if (isAudioTurn && parsed.transcript !== undefined && parsed.response !== undefined) {
          return { transcript: parsed.transcript, responseText: parsed.response };
        }

        if (!isAudioTurn && parsed.response !== undefined) {
          return { transcript: '', responseText: parsed.response };
        }
      } catch {
        // Not valid JSON, continue to fallback
      }
    }

    // Fallback: model went straight to tool call
    if (hasToolCalls) {
      return {
        transcript: isAudioTurn ? '[audio processed]' : '',
        responseText: content,
      };
    }

    const expectedFormat = isAudioTurn ? '{"transcript":"...","response":"..."}' : '{"response":"..."}';
    throw new Error(`CloudAudioLLM: Expected JSON ${expectedFormat} but got: ${content.substring(0, 100)}`);
  }

  // ============================================================
  // Internal: Helpers
  // ============================================================

  private encodeAudioToBase64(audio: Float32Array): string {
    const numChannels = 1;
    const sampleRate = this.config.sampleRate!;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = audio.length * 2;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < audio.length; i++) {
      const sample = Math.max(-1, Math.min(1, audio[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }

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
