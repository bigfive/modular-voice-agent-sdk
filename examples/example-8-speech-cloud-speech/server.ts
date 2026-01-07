/**
 * Server for speech-cloud-speech Example
 *
 * Hybrid mode: Client handles STT and TTS, server proxies to OpenAI
 * - STT: Client (WebSpeech) - server receives text
 * - LLM: OpenAI API (gpt-5-nano) with tool calling
 * - TTS: Client (WebSpeech) - server sends text only
 *
 * Demonstrates tool/function calling with:
 * - get_current_time: Returns the current time
 * - get_weather: Returns mock weather for a location
 * - roll_dice: Rolls dice (e.g., "2d6")
 *
 * Environment:
 *   OPENAI_API_KEY - OpenAI API key (required)
 *
 * Run: npm run example8
 */

import { createVoicePipeline } from 'modular-voice-agent-sdk';
import { CloudLLM } from 'modular-voice-agent-sdk/cloud';
import { createPipelineHandler } from 'modular-voice-agent-sdk/server';
import { startWebSocketServer, logPipelineInfo, demoTools } from '../shared';

const PORT = 3105;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  console.error('  export OPENAI_API_KEY=sk-your-key-here');
  process.exit(1);
}

const CONFIG = {
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: OPENAI_API_KEY,
    model: 'gpt-5-mini',
    modelParams: {
      max_completion_tokens: 256,
    },
  },
  systemPrompt: `You are a helpful voice assistant. Keep responses brief—1-2 sentences. Speak naturally.`,
};

async function main(): Promise<void> {
  console.log('Initializing OpenAI LLM pipeline with tools...');
  console.log(`  Model:  ${CONFIG.llm.model}`);
  console.log(`  STT:    Client handles (WebSpeech)`);
  console.log(`  TTS:    Client handles (WebSpeech)`);
  console.log(`  Tools:  ${demoTools.map(t => t.name).join(', ')}`);

  // LLM-only pipeline with tools - client handles STT and TTS
  const pipeline = createVoicePipeline({
    create: () => ({
      stt: null,  // Client does WebSpeech STT
      llm: new CloudLLM(CONFIG.llm),
      tts: null,  // Client does WebSpeech TTS
      systemPrompt: CONFIG.systemPrompt,
    }),
    tools: demoTools,
  });

  await pipeline.initialize();
  console.log('Cloud LLM pipeline with tools ready.');

  const handler = createPipelineHandler(pipeline);
  logPipelineInfo(handler);

  startWebSocketServer({ port: PORT, handler });

  console.log(`Server running on ws://localhost:${PORT}`);
  console.log('');
  console.log('Try asking:');
  console.log('  - "What time is it?"');
  console.log('  - "What\'s the weather in Tokyo?"');
  console.log('  - "Roll 2d6 for me"');
}

main().catch(console.error);
