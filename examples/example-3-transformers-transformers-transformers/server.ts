/**
 * Server Example - Transformers.js Backend
 *
 * Full remote mode: STT → LLM → TTS
 * Client sends audio, server returns audio.
 */

import { VoicePipeline, TransformersSTT, TransformersLLM, TransformersTTS } from 'modular-voice-agent-sdk';
import { createPipelineHandler } from 'modular-voice-agent-sdk/server';
import { startWebSocketServer, logPipelineInfo } from '../shared';

const PORT = 3100;

const CONFIG = {
  stt: { model: 'Xenova/whisper-small', dtype: 'q8', language: 'en' },
  llm: { model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct', dtype: 'q4', maxNewTokens: 140, temperature: 0.7 },
  tts: { model: 'Xenova/speecht5_tts', dtype: 'fp16', speakerEmbeddings: 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin' },
  systemPrompt: 'You are a helpful voice assistant. Keep responses brief—1-2 sentences. Speak naturally.',
};

async function main(): Promise<void> {
  console.log('Loading Transformers.js models...');

  const pipeline = new VoicePipeline({
    stt: () => new TransformersSTT(CONFIG.stt),
    llm: () => new TransformersLLM(CONFIG.llm),
    tts: () => new TransformersTTS(CONFIG.tts),
    systemPrompt: CONFIG.systemPrompt,
  });

  await pipeline.initialize();
  console.log('Models loaded.');

  const handler = createPipelineHandler(pipeline);
  logPipelineInfo(handler);

  startWebSocketServer({ port: PORT, handler });

  console.log(`Server running on ws://localhost:${PORT}`);
}

main().catch(console.error);
