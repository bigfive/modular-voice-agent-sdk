/**
 * Transformers.js LLM Pipeline
 * Isomorphic - works in browser (WebGPU) and Node.js
 *
 * Supports any causal LLM model from Hugging Face that works with Transformers.js,
 * including SmolLM, Phi, Qwen, Gemma, and others.
 *
 * Note: This backend does not support native tool calling.
 * When tools are provided, it injects instructions into the system prompt
 * for JSON-based tool calling, parsed by VoicePipeline.
 */

import { pipeline } from '@huggingface/transformers';
import type {
  LLMPipeline,
  TransformersLLMConfig,
  ProgressCallback,
  Message,
  LLMGenerateOptions,
  LLMGenerateResult,
  ToolMessage,
  ToolDefinition,
} from '../../types';
import { LLMLogger, LLMConversationTracker, type TrackerMessage } from '../../services';
import type { ModelStore } from '../../voice-pipeline';

export class TransformersLLM implements LLMPipeline {
  private config: TransformersLLMConfig;
  private modelStore: ModelStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;
  private ready = false;
  private tracker: LLMConversationTracker;

  /**
   * @param config - LLM configuration
   * @param modelStore - Pipeline-scoped model store for caching.
   *   Models are cached here and shared across sessions within the same pipeline.
   */
  constructor(config: TransformersLLMConfig, modelStore: ModelStore) {
    this.config = config;
    this.modelStore = modelStore;
    this.tracker = new LLMConversationTracker(new LLMLogger());
  }

  async initialize(onProgress?: ProgressCallback): Promise<void> {
    if (this.modelStore.has('llm')) {
      this.pipe = this.modelStore.get('llm');
    } else {
      console.log(`Loading LLM model (${this.config.model})...`);
      this.pipe = await pipeline('text-generation', this.config.model, {
        dtype: this.config.dtype as 'fp32' | 'fp16' | 'q8' | 'q4',
        device: this.config.device,
        progress_callback: onProgress,
      });
      console.log('LLM model loaded.');
      this.modelStore.set('llm', this.pipe);
    }

    this.ready = true;
  }

  supportsTools(): boolean {
    // Transformers backend doesn't support tool calling natively
    // Tools are handled via prompt injection at the VoicePipeline level
    return false;
  }

  async generate(messages: Message[], options?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    if (!this.pipe) {
      throw new Error('LLM pipeline not initialized');
    }

    // Log input messages
    this.tracker.logInput(messages as TrackerMessage[]);

    const prompt = this.formatChatPrompt(messages, options?.tools);

    const result = await this.pipe(prompt, {
      max_new_tokens: this.config.maxNewTokens,
      do_sample: true,
      temperature: this.config.temperature,
      return_full_text: false,
    });

    let response = result[0]?.generated_text?.trim() || '';
    response = response.replace(/<\|im_end\|>.*$/s, '').trim();

    // Log the response
    this.tracker.logOutput(response);

    // Stream character by character
    for (const char of response) {
      options?.onToken?.(char);
    }

    return {
      content: response,
      finishReason: 'stop',
    };
  }

  /**
   * Build tool instructions to inject into system prompt
   */
  private buildToolInstructions(tools: ToolDefinition[]): string {
    const toolsJson = JSON.stringify(
      tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
      null,
      2
    );

    return `

You have access to tools. When you need to use a tool, respond with ONLY this JSON (no other text before or after):
{"tool_call": {"name": "tool_name", "arguments": {...}}}

Available tools:
${toolsJson}

IMPORTANT:
- If using a tool, respond ONLY with the JSON tool_call object, nothing else.
- After you receive a tool result, provide your natural language response to the user.
- Only use tools when necessary. For simple questions, respond directly.`;
  }

  private formatChatPrompt(messages: Message[], tools?: ToolDefinition[]): string {
    let prompt = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Inject tool instructions into system message if tools are provided
        const content = tools && tools.length > 0
          ? msg.content + this.buildToolInstructions(tools)
          : msg.content;
        prompt += `<|im_start|>system\n${content}<|im_end|>\n`;
      } else if (msg.role === 'user') {
        prompt += `<|im_start|>user\n${msg.content}<|im_end|>\n`;
      } else if (msg.role === 'assistant') {
        prompt += `<|im_start|>assistant\n${msg.content}<|im_end|>\n`;
      } else if (msg.role === 'tool') {
        const toolMsg = msg as ToolMessage;
        prompt += `<|im_start|>tool\n[Tool Result: ${toolMsg.toolCallId}]\n${msg.content}<|im_end|>\n`;
      }
    }

    prompt += '<|im_start|>assistant\n';
    return prompt;
  }

  isReady(): boolean {
    return this.ready;
  }
}

