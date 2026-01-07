/**
 * Server for CloudAudioLLM Example (OpenAI gpt-audio-mini)
 *
 * Multimodal mode: Server processes audio directly via OpenAI API
 * - STT+LLM: CloudAudioLLM (single API call - audio in, text out)
 * - TTS: Client (WebSpeech)
 *
 * The CloudAudioLLM implements both STTPipeline and LLMPipeline interfaces.
 * When registered as both stt and llm, it makes a single API call that:
 * 1. Transcribes the audio (returned via onTranscript callback)
 * 2. Generates a response (streamed to client)
 *
 * Demonstrates multimodal audio LLMs with tool/function calling:
 * - get_current_time: Returns the current time
 * - get_weather: Returns mock weather for a location
 * - roll_dice: Rolls dice (e.g., "2d6")
 *
 * Prerequisites:
 *   Set OPENAI_API_KEY environment variable.
 *
 * Run: npm run example10
 */

import { createVoicePipeline } from 'modular-voice-agent-sdk';
import { CloudAudioLLM } from 'modular-voice-agent-sdk/cloud';
import { createPipelineHandler } from 'modular-voice-agent-sdk/server';
import { startWebSocketServer, logPipelineInfo, demoTools } from '../shared';

const PORT = 3107;

// Configuration for OpenAI gpt-audio-mini (audio-capable model)
const CONFIG = {
  audioLLM: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-audio-mini', // Must be audio-capable model (gpt-audio-mini, gpt-audio)
    modelParams: {
      max_completion_tokens: 256,
    },
    sampleRate: 16000,
  },
  systemPrompt: `You are a helpful voice assistant. Keep responses brief—1-2 sentences. Speak naturally.`,
};

async function main(): Promise<void> {
  if (!CONFIG.audioLLM.apiKey) {
    console.error('❌ OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log('Initializing CloudAudioLLM pipeline (OpenAI gpt-audio-mini)...');
  console.log(`  Server: ${CONFIG.audioLLM.baseUrl}`);
  console.log(`  Model:  ${CONFIG.audioLLM.model}`);
  console.log(`  Mode:   Audio → LLM (single API call)`);
  console.log(`  TTS:    Client handles (WebSpeech)`);
  console.log(`  Tools:  ${demoTools.map((t) => t.name).join(', ')}`);
  console.log('');

  // Single factory creates both STT and LLM as the same instance
  // CloudAudioLLM implements both interfaces - single API call: audio → transcript + response
  const pipeline = createVoicePipeline({
    create: (/* modelStore */) => {
      const audioLLM = new CloudAudioLLM(CONFIG.audioLLM);
      return {
        stt: audioLLM,  // Same instance handles transcription
        llm: audioLLM,  // Same instance handles generation (uses cached response)
        tts: null,      // Client does WebSpeech TTS
        systemPrompt: CONFIG.systemPrompt,
      };
    },
    tools: demoTools,
  });

  await pipeline.initialize();
  console.log('CloudAudioLLM pipeline ready.');
  console.log('');
  console.log('How it works:');
  console.log('  1. Client sends audio');
  console.log('  2. stt.transcribe() → API call with audio, caches response');
  console.log('  3. llm.generate() → Returns cached response (no 2nd call!)');
  console.log('  4. Client receives transcript + response, speaks via WebSpeech');

  const handler = createPipelineHandler(pipeline);
  logPipelineInfo(handler);

  startWebSocketServer({ port: PORT, handler });

  console.log(`Server running on ws://localhost:${PORT}`);
  console.log('');
  console.log('Try asking:');
  console.log('  - "What time is it?"');
  console.log("  - \"What's the weather in Tokyo?\"");
  console.log('  - "Roll 2d6 for me"');
}

main().catch(console.error);
