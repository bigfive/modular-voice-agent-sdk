/**
 * Server Example - Native Backends (whisper.cpp, llama.cpp, sherpa-onnx)
 *
 * Full remote mode: STT → LLM → TTS
 * Client sends audio, server returns audio.
 */

import { VoicePipeline } from 'modular-voice-agent-sdk';
import { NativeSTT, NativeLLM, NativeTTS, getBinaryPath, getModelPath, getCacheDir } from 'modular-voice-agent-sdk/native';
import { createPipelineHandler } from 'modular-voice-agent-sdk/server';
import { startWebSocketServer, logPipelineInfo } from '../shared';

const PORT = 3101;

// Model paths - must match models.json in this directory
// Run: npx modular-voice-agent-sdk setup examples/example-4-native-native-native/models.json
// Run: npx modular-voice-agent-sdk setup --binaries-only
const CONFIG = {
  stt: {
    binaryPath: getBinaryPath('whisper-cli'),
    modelPath: getModelPath('whisper-large-v3-turbo-q8.bin'),
    language: 'en',
  },
  llm: {
    binaryPath: getBinaryPath('llama-completion'),
    modelPath: getModelPath('smollm2-1.7b-instruct-q4_k_m.gguf'),
    maxNewTokens: 140,
    temperature: 0.7,
    gpuLayers: 0,
  },
  tts: {
    binaryPath: getBinaryPath('sherpa-onnx-offline-tts'),
    modelDir: getModelPath('vits-piper-en_US-lessac-medium'),
  },
  systemPrompt: 'You are a helpful voice assistant. Keep responses brief—1-2 sentences. Speak naturally.',
};

async function main(): Promise<void> {
  console.log('Initializing native pipelines...');
  console.log(`  Cache:        ${getCacheDir()}`);
  console.log(`  Whisper:      ${CONFIG.stt.binaryPath}`);
  console.log(`  Llama:        ${CONFIG.llm.binaryPath}`);
  console.log(`  Sherpa-ONNX:  ${CONFIG.tts.binaryPath}`);

  const pipeline = new VoicePipeline({
    stt: new NativeSTT(CONFIG.stt),
    llm: new NativeLLM(CONFIG.llm),
    tts: new NativeTTS(CONFIG.tts),
    systemPrompt: CONFIG.systemPrompt,
  });

  await pipeline.initialize();
  console.log('Native pipelines ready.');

  const handler = createPipelineHandler(pipeline);
  logPipelineInfo(handler);

  startWebSocketServer({ port: PORT, handler });

  console.log(`Server running on ws://localhost:${PORT}`);
}

main().catch(console.error);
