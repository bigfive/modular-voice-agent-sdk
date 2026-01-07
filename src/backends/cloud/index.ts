/**
 * Cloud Backend - OpenAI-compatible API
 * Works with: OpenAI, Ollama, vLLM, LMStudio, and any OpenAI-compatible endpoint
 */

export { CloudLLM } from './llm';
export type { CloudLLMConfig } from '../../types';

// Audio LLM (multimodal - implements both STTPipeline and LLMPipeline)
export { CloudAudioLLM } from './audio-llm';
export type { CloudAudioLLMConfig } from './audio-llm';

