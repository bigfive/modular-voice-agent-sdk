/**
 * Native LLM Pipeline (llama.cpp)
 * Server-only - requires native binary (llama-completion)
 *
 * When tools are provided, uses GBNF grammar that allows either:
 * - TOOL: [{"name": "...", "arguments": {...}}] for tool invocations
 * - SAY: natural language for direct responses (streamable!)
 *
 * This allows real token streaming for text responses while maintaining
 * structured tool calling when needed.
 */

import { spawn } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
  LLMPipeline,
  NativeLLMConfig,
  ProgressCallback,
  Message,
  LLMGenerateOptions,
  LLMGenerateResult,
  ToolDefinition,
  AssistantMessage,
} from '../../types';
import { LLMLogger, LLMConversationTracker, type TrackerMessage } from '../../services';

export class NativeLLM implements LLMPipeline {
  private config: NativeLLMConfig;
  private ready = false;
  private tracker: LLMConversationTracker;

  constructor(config: NativeLLMConfig) {
    this.config = config;
    this.tracker = new LLMConversationTracker(new LLMLogger());
  }

  async initialize(_onProgress?: ProgressCallback): Promise<void> {
    if (!existsSync(this.config.binaryPath)) {
      throw new Error(`llama-completion binary not found at: ${this.config.binaryPath}`);
    }
    if (!existsSync(this.config.modelPath)) {
      throw new Error(`LLM model not found at: ${this.config.modelPath}`);
    }

    this.ready = true;
  }

  supportsTools(): boolean {
    return true;
  }

  async generate(messages: Message[], options?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    if (!this.ready) {
      throw new Error('LLM pipeline not initialized');
    }

    // If tools are provided, use grammar mode for guaranteed valid JSON
    if (options?.tools && options.tools.length > 0) {
      return this.generateWithGrammar(messages, options);
    }

    // No tools: regular freeform generation
    return this.generateFreeform(messages, options);
  }


  /**
   * Build the tool system prompt
   */
  private buildToolSystemPrompt(tools: ToolDefinition[]): string {
    const toolsJson = JSON.stringify(
      tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      null,
      2
    );

    return `
You have access to tools, but ONLY use them when explicitly needed:
<tools>${toolsJson}</tools>

IMPORTANT: Default to SAY for most interactions. Only use tools when the user EXPLICITLY asks for something the tool provides.

Response formats:
- SAY: Your natural language response — USE THIS BY DEFAULT for greetings, conversation, questions, explanations, and any response where you don't need external data.
- TOOL: [{"name": "tool_name", "arguments": {"arg1": "value1"}}] — ONLY use when the user specifically requests information that requires a tool (e.g., "what time is it?" needs get_current_time).

Examples of when NOT to use tools:
- "Hello" / "Hi" / "Hey" → just greet back with SAY:
- "How are you?" → respond naturally with SAY:
- "Tell me a joke" → respond with SAY:
- "What can you do?" → describe capabilities with SAY:`;
  }

  /**
   * Generate with GBNF grammar constraint
   * Allows either:
   * - TOOL: [{...}] for tool invocations
   * - SAY: text for streamable text responses
   */
  private async generateWithGrammar(
    messages: Message[],
    options: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    const tools = options.tools ?? [];

    // Build grammar that allows say OR tool_call
    const grammar = this.buildToolGrammar(tools);

    // Write grammar to temp file (llama-completion needs a file path)
    const grammarPath = join(tmpdir(), `grammar-${Date.now()}.gbnf`);
    writeFileSync(grammarPath, grammar);

    try {
      const prompt = this.formatChatPromptWithTools(messages, tools);

      // llama-completion args for clean non-interactive output
      const args = [
        '-m', this.config.modelPath,
        '-n', String(this.config.maxNewTokens),
        '--temp', String(this.config.temperature ?? 0.7),
        '--grammar-file', grammarPath,
        '--no-display-prompt',  // Don't echo the prompt back
        '--simple-io',          // Clean output without ANSI codes
        '-no-cnv',              // Non-conversation mode (single completion)
        '-p', prompt,
      ];

      if (this.config.gpuLayers) {
        args.push('-ngl', String(this.config.gpuLayers));
      }

      // Use streaming completion that handles both formats
      const result = await this.runLlamaCompletionWithStreaming(args, messages, options);

      return result;
    } finally {
      // Clean up temp grammar file
      try {
        unlinkSync(grammarPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Parse tool call output
   * TOOL: [{"name": "...", "arguments": {...}}]
   */
  private parseToolCallOutput(output: string): Array<{ name: string; arguments: Record<string, unknown> }> | null {
    // The output should already be just the JSON array (TOOL: prefix stripped)
    const jsonStr = output.trim();

    try {
      const parsed = JSON.parse(jsonStr.trim());

      // Handle array format
      if (Array.isArray(parsed)) {
        return parsed.filter(tc => tc && typeof tc.name === 'string');
      }

      // Handle single object format (legacy)
      if (parsed && typeof parsed.name === 'string') {
        return [parsed];
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Build GBNF grammar that allows either:
   * - TOOL: [{"name": "...", "arguments": {...}}]
   * - SAY: free text
   */
  private buildToolGrammar(tools: ToolDefinition[]): string {
    // Build tool name alternatives: "get_weather" | "search"
    const toolNames = tools.map(t => `"\\"${t.name}\\""`).join(' | ');

    return `# Grammar allowing text responses OR tool calls
# Output: SAY: text OR TOOL: [json]

root ::= say-response | tool-call

# Say response - free form text (streamable)
say-response ::= "SAY:" ws text-content
text-content ::= text-char+
text-char ::= [a-zA-Z0-9 .,!?'\"():;\\n\\t\\r-]

# Tool call - structured JSON
tool-call ::= "TOOL:" ws tool-array

tool-array ::= "[" ws tool-obj ws "]"

tool-obj ::= "{" ws "\\"name\\":" ws tool-name "," ws "\\"arguments\\":" ws arguments ws "}"

tool-name ::= ${toolNames}

arguments ::= "{" ws (keyval ("," ws keyval)*)? ws "}"
keyval ::= string ":" ws value

value ::= string | number | bool | null | object | array
string ::= "\\"" chars "\\""
chars ::= char*
char ::= [^"\\\\\\x00-\\x1f] | "\\\\" escape
escape ::= ["\\\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F]
number ::= "-"? ("0" | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [+-]? [0-9]+)?
bool ::= "true" | "false"
null ::= "null"
object ::= "{" ws (keyval ("," ws keyval)*)? ws "}"
array ::= "[" ws (value ("," ws value)*)? ws "]"

ws ::= [ \\t\\n]*
`;
  }

  /**
   * Format chat prompt with tool definitions (for grammar mode)
   * Uses ChatML format with tool instructions
   */
  private formatChatPromptWithTools(messages: Message[], tools: ToolDefinition[]): string {
    const toolSystemPrompt = this.buildToolSystemPrompt(tools);

    let prompt = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Combine system prompt with tool instructions
        prompt += `<|im_start|>system\n${msg.content}\n\n${toolSystemPrompt}<|im_end|>\n`;
      } else if (msg.role === 'user') {
        prompt += `<|im_start|>user\n${msg.content}<|im_end|>\n`;
      } else if (msg.role === 'assistant') {
        const assistantMsg = msg as AssistantMessage;
        if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
          // Format tool calls
          const toolCallJson = JSON.stringify(
            assistantMsg.toolCalls.map(tc => ({
              name: tc.name,
              arguments: tc.arguments,
            }))
          );
          prompt += `<|im_start|>assistant\nTOOL: ${toolCallJson}<|im_end|>\n`;
        } else if (assistantMsg.content) {
          // Format say response
          prompt += `<|im_start|>assistant\nSAY: ${msg.content}<|im_end|>\n`;
        }
      } else if (msg.role === 'tool') {
        prompt += `<|im_start|>tool\n${msg.content}<|im_end|>\n`;
      }
    }

    // If no system message was in history, add tool prompt as system
    if (!messages.some(m => m.role === 'system')) {
      prompt = `<|im_start|>system\n${toolSystemPrompt}<|im_end|>\n` + prompt;
    }

    prompt += '<|im_start|>assistant\n';
    return prompt;
  }

  /** Special tokens to filter from output */
  private static readonly SPECIAL_TOKENS = /\[end of text\]|<\|im_end\|>|<\|im_start\|>|<\|endoftext\|>/gi;

  /**
   * Run llama-completion and capture output
   * Output goes to stdout, debug/timing info goes to stderr (ignored)
   */
  private runLlamaCompletion(args: string[], messages: Message[], options?: LLMGenerateOptions): Promise<string> {
    // Log the input messages
    this.tracker.logInput(messages as TrackerMessage[]);

    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.binaryPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';

      proc.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;

        // Stream tokens if callback provided, filtering out special markers
        // llama.cpp sends special tokens as complete strings, not split across chunks
        if (options?.onToken) {
          const filtered = chunk.replace(NativeLLM.SPECIAL_TOKENS, '');
          for (const char of filtered) {
            options.onToken(char);
          }
        }
      });

      proc.stderr.on('data', () => {
        // Ignore stderr (Metal init messages, timing info, etc.)
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`llama-completion exited with code ${code}`));
          return;
        }

        // Clean up output - remove special tokens
        const cleaned = output.replace(NativeLLM.SPECIAL_TOKENS, '').trim();
        this.tracker.logRawOutput(cleaned);
        resolve(cleaned);
      });

      proc.on('error', reject);
    });
  }

  /**
   * Run llama-completion with smart streaming
   * - SAY: streams tokens as they arrive
   * - TOOL: buffers until complete, then parses
   */
  private runLlamaCompletionWithStreaming(
    args: string[],
    messages: Message[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    this.tracker.logInput(messages as TrackerMessage[]);

    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.binaryPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let buffer = '';
      let mode: 'detecting' | 'say' | 'tool_call' = 'detecting';
      let textContent = '';
      let isStreaming = false;

      const SAY_PREFIX = 'SAY:';
      const TOOL_PREFIX = 'TOOL:';

      proc.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString().replace(NativeLLM.SPECIAL_TOKENS, '');
        buffer += chunk;

        // Detect mode from prefix
        if (mode === 'detecting') {
          // Trim leading whitespace for detection
          const trimmed = buffer.trimStart();
          if (trimmed.startsWith(SAY_PREFIX)) {
            mode = 'say';
            isStreaming = true;
            // Remove everything up to and including SAY:
            const sayIndex = buffer.indexOf(SAY_PREFIX);
            buffer = buffer.slice(sayIndex + SAY_PREFIX.length).trimStart();
          } else if (trimmed.startsWith(TOOL_PREFIX)) {
            mode = 'tool_call';
            // Remove everything up to and including TOOL:
            const toolIndex = buffer.indexOf(TOOL_PREFIX);
            buffer = buffer.slice(toolIndex + TOOL_PREFIX.length).trimStart();
          } else if (trimmed.length >= TOOL_PREFIX.length) {
            // Buffer is long enough but doesn't match expected prefixes
            // This shouldn't happen with grammar, but handle gracefully
            mode = 'say';
            isStreaming = true;
          }
        }

        // Stream say content (no closing tag needed - just stream everything)
        if (mode === 'say' && isStreaming && options?.onToken) {
          for (const char of buffer) {
            options.onToken(char);
          }
          textContent += buffer;
          buffer = '';
        }
      });

      proc.stderr.on('data', () => {
        // Ignore stderr
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`llama-completion exited with code ${code}`));
          return;
        }

        // Final processing based on mode
        const fullOutput = (mode === 'say' ? SAY_PREFIX + ' ' : TOOL_PREFIX + ' ') +
                          (textContent || '') + buffer;
        this.tracker.logRawOutput(fullOutput.replace(NativeLLM.SPECIAL_TOKENS, '').trim());

        if (mode === 'say') {
          // Any remaining content in buffer
          const remaining = buffer.trim();
          if (remaining && options?.onToken) {
            for (const char of remaining) {
              options.onToken(char);
            }
          }
          const finalContent = textContent + remaining;

          resolve({
            content: finalContent,
            finishReason: 'stop',
          });
        } else if (mode === 'tool_call') {
          // Parse tool call JSON
          const toolCalls = this.parseToolCallOutput(buffer);

          if (toolCalls && toolCalls.length > 0) {
            resolve({
              content: '',
              toolCalls: toolCalls.map((tc, i) => ({
                id: `native-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`,
                name: tc.name,
                arguments: tc.arguments || {},
              })),
              finishReason: 'tool_calls',
            });
          } else {
            // Failed to parse tool call
            resolve({
              content: buffer,
              finishReason: 'stop',
            });
          }
        } else {
          // Detection never completed - return raw buffer
          resolve({
            content: buffer,
            finishReason: 'stop',
          });
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Freeform generation (no grammar) - used when no tools are provided
   */
  private async generateFreeform(
    messages: Message[],
    options?: LLMGenerateOptions
  ): Promise<LLMGenerateResult> {
    const prompt = this.formatChatPrompt(messages);

    // llama-completion args for clean non-interactive output
    const args = [
      '-m', this.config.modelPath,
      '-n', String(this.config.maxNewTokens),
      '--temp', String(this.config.temperature ?? 0.7),
      '--no-display-prompt',  // Don't echo the prompt back
      '--simple-io',          // Clean output without ANSI codes
      '-no-cnv',              // Non-conversation mode (single completion)
      '-p', prompt,
    ];

    if (this.config.gpuLayers) {
      args.push('-ngl', String(this.config.gpuLayers));
    }

    const output = await this.runLlamaCompletion(args, messages, options);

    return {
      content: output,
      finishReason: 'stop',
    };
  }

  /**
   * Format basic chat prompt (for non-tool mode)
   */
  private formatChatPrompt(messages: Message[]): string {
    let prompt = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        prompt += `<|im_start|>system\n${msg.content}<|im_end|>\n`;
      } else if (msg.role === 'user') {
        prompt += `<|im_start|>user\n${msg.content}<|im_end|>\n`;
      } else if (msg.role === 'assistant') {
        prompt += `<|im_start|>assistant\n${msg.content}<|im_end|>\n`;
      } else if (msg.role === 'tool') {
        prompt += `<|im_start|>tool\n${msg.content}<|im_end|>\n`;
      }
    }

    prompt += '<|im_start|>assistant\n';
    return prompt;
  }

  isReady(): boolean {
    return this.ready;
  }
}
