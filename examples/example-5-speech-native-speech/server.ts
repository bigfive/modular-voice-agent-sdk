/**
 * Server for speech-native-speech Example
 *
 * Hybrid mode: Client handles STT and TTS, server only does LLM
 * - STT: Client (WebSpeech) - server receives text
 * - LLM: Native llama.cpp with tool calling (grammar-constrained)
 * - TTS: Client (WebSpeech) - server sends text only
 *
 * Demonstrates tool/function calling with native LLM:
 * - get_current_time: Returns the current time
 * - get_weather: Returns mock weather for a location
 * - roll_dice: Rolls dice (e.g., "2d6")
 *
 * Native LLM uses GBNF grammar that allows either:
 * - <tool_call>[...]</tool_call> for structured tool invocations
 * - <text_response>...</text_response> for streamable text responses
 *
 * This enables real token streaming for natural language responses while
 * maintaining reliable JSON for tool calls.
 *
 * Run: npm run dev:speech-native
 */

import { createVoicePipeline } from 'modular-voice-agent-sdk';
import { NativeLLM, getBinaryPath, getModelPath, getCacheDir } from 'modular-voice-agent-sdk/native';
import { createPipelineHandler } from 'modular-voice-agent-sdk/server';
import { startWebSocketServer, logPipelineInfo, demoTools } from '../shared';

const PORT = 3104;

// Model paths - must match models.json in this directory
// Run: npx modular-voice-agent-sdk setup examples/example-5-speech-native-speech/models.json
// Run: npx modular-voice-agent-sdk setup --binaries-only
const CONFIG = {
  llm: {
    binaryPath: getBinaryPath('llama-completion'),
    modelPath: getModelPath('qwen3-14b-q4_k_m.gguf'),
    maxNewTokens: 256,
    temperature: 0.7,
    gpuLayers: 0,  // Set higher if you have GPU memory (e.g., 35 for ~16GB VRAM)
  },
  systemPrompt: `You are a helpful voice assistant. Keep responses brief—1-2 sentences. Speak naturally. /no_think`,
};

async function main(): Promise<void> {
  console.log('Initializing Native LLM pipeline with tools (client handles STT/TTS)...');
  console.log(`  Cache: ${getCacheDir()}`);
  console.log(`  Llama: ${CONFIG.llm.binaryPath}`);
  console.log(`  STT:   Client handles (WebSpeech)`);
  console.log(`  TTS:   Client handles (WebSpeech)`);
  console.log(`  Tools: ${demoTools.map(t => t.name).join(', ')}`);

  // LLM-only pipeline with tools - client handles STT and TTS
  const pipeline = createVoicePipeline({
    create: (/* modelStore */) => ({
      stt: null,  // Client does WebSpeech STT
      llm: new NativeLLM(CONFIG.llm),
      tts: null,  // Client does WebSpeech TTS
      systemPrompt: CONFIG.systemPrompt,
    }),
    tools: demoTools,
  });

  await pipeline.initialize();
  console.log('Native LLM pipeline with tools ready.');

  const handler = createPipelineHandler(pipeline);
  logPipelineInfo(handler);

  startWebSocketServer({ port: PORT, handler });

  console.log(`Server running on ws://localhost:${PORT}`);
  console.log('');
  console.log('Try asking:');
  console.log('  - "What time is it?"');
  console.log('  - "What\'s the weather in Tokyo?"');
  console.log('  - "Roll 2d6 for me"');
  console.log('');
  console.log('Note: Native LLM uses grammar-constrained generation with streaming text responses.');
}

main().catch(console.error);
