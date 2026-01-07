/**
 * Server for transformers-transformers-speech Example
 *
 * Hybrid mode: Server handles STT and LLM, client handles TTS
 * - STT: Transformers.js Whisper (server)
 * - LLM: Transformers.js TransformersLLM (server)
 * - TTS: Client (WebSpeech) - server sends text only
 *
 * Run: npm run dev:transformers-speech
 */

import { VoicePipeline, TransformersSTT, TransformersLLM } from 'modular-voice-agent-sdk';
import { createPipelineHandler } from 'modular-voice-agent-sdk/server';
import { startWebSocketServer, logPipelineInfo } from '../shared';

const PORT = 3103;

const CONFIG = {
  stt: { model: 'Xenova/whisper-small', dtype: 'q8', language: 'en' },
  llm: { model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct', dtype: 'q4', maxNewTokens: 140, temperature: 0.7 },
  systemPrompt: 'You are a helpful voice assistant. Keep responses brief—1-2 sentences. Speak naturally.',
};

async function main(): Promise<void> {
  console.log('Loading Transformers.js models (STT + LLM only)...');
  console.log(`  STT: ${CONFIG.stt.model}`);
  console.log(`  LLM: ${CONFIG.llm.model}`);
  console.log(`  TTS: Client handles (WebSpeech)`);

  // STT + LLM pipeline - client handles TTS
  const pipeline = new VoicePipeline({
    stt: new TransformersSTT(CONFIG.stt),
    llm: new TransformersLLM(CONFIG.llm),
    tts: null,  // Client does WebSpeech TTS
    systemPrompt: CONFIG.systemPrompt,
  });

  await pipeline.initialize();
  console.log('Models loaded.');

  const handler = createPipelineHandler(pipeline);
  logPipelineInfo(handler);

  startWebSocketServer({ port: PORT, handler });

  console.log(`Server running on ws://localhost:${PORT}`);
  console.log('');
  console.log('This server handles STT and LLM - client handles TTS with WebSpeech.');
  console.log('Audio is sent to server, text is returned (no audio back).');
}

main().catch(console.error);
