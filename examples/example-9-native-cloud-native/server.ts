/**
 * Server Example - Native STT/TTS with OpenAI LLM
 *
 * Full remote mode: STT → LLM → TTS all on server
 * - STT: whisper.cpp (native binary)
 * - LLM: OpenAI API (gpt-5-nano)
 * - TTS: sherpa-onnx (native binary)
 *
 * Client sends audio, server returns audio.
 *
 * Environment:
 *   OPENAI_API_KEY - OpenAI API key (required)
 *
 * Run: npm run example9
 */

import { VoicePipeline } from 'modular-voice-agent-sdk';
import { NativeSTT, NativeTTS, getBinaryPath, getModelPath, getCacheDir } from 'modular-voice-agent-sdk/native';
import { CloudLLM } from 'modular-voice-agent-sdk/cloud';
import { createPipelineHandler } from 'modular-voice-agent-sdk/server';
import { startWebSocketServer, logPipelineInfo } from '../shared';

const PORT = 3106;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  console.error('  export OPENAI_API_KEY=sk-your-key-here');
  process.exit(1);
}

// Model paths - must match models.json in this directory
// Run: npx modular-voice-agent-sdk setup examples/example-9-native-cloud-native/models.json
// Run: npx modular-voice-agent-sdk setup --binaries-only
const CONFIG = {
  stt: {
    binaryPath: getBinaryPath('whisper-cli'),
    modelPath: getModelPath('whisper-large-v3-turbo-q8.bin'),
    language: 'en',
  },
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: OPENAI_API_KEY,
    model: 'gpt-5-nano',
    maxTokens: 256,
    temperature: 0.7,
  },
  tts: {
    binaryPath: getBinaryPath('sherpa-onnx-offline-tts'),
    modelDir: getModelPath('vits-piper-en_US-lessac-medium'),
  },
  systemPrompt: 'You are a helpful voice assistant. Keep responses brief—1-2 sentences. Speak naturally.',
};

async function main(): Promise<void> {
  console.log('Initializing native STT/TTS + OpenAI LLM pipeline...');
  console.log(`  Cache:        ${getCacheDir()}`);
  console.log(`  Whisper:      ${CONFIG.stt.binaryPath}`);
  console.log(`  OpenAI LLM:   ${CONFIG.llm.model}`);
  console.log(`  Sherpa-ONNX:  ${CONFIG.tts.binaryPath}`);

  const pipeline = new VoicePipeline({
    stt: new NativeSTT(CONFIG.stt),
    llm: new CloudLLM(CONFIG.llm),
    tts: new NativeTTS(CONFIG.tts),
    systemPrompt: CONFIG.systemPrompt,
  });

  await pipeline.initialize();
  console.log('Pipeline ready.');

  const handler = createPipelineHandler(pipeline);
  logPipelineInfo(handler);

  startWebSocketServer({ port: PORT, handler });

  console.log(`Server running on ws://localhost:${PORT}`);
  console.log('');
  console.log('Full server-side processing: Audio → whisper.cpp → OpenAI → sherpa-onnx → Audio');
}

main().catch(console.error);
