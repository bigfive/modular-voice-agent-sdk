/**
 * Cloud Backend - Multi-provider API support
 * Works with: OpenAI, Anthropic, Ollama, vLLM, LMStudio, and any compatible endpoint
 */

export { CloudLLM } from './llm';
export type { CloudLLMConfig } from '../../types';

// Audio LLM (multimodal - implements both STTPipeline and LLMPipeline)
export { CloudAudioLLM } from './audio-llm';
export type { CloudAudioLLMConfig } from './audio-llm';

// LLM Providers
export type { LLMProvider, SystemPromptBlock, ParsedStreamChunk } from './providers';
export { OpenAICompletionsProvider } from './openai-provider';
export { AnthropicMessagesProvider } from './anthropic-provider';

