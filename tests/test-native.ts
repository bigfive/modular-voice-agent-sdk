/**
 * Test script for native backends (whisper.cpp, llama.cpp, sherpa-onnx)
 * Run with: npx tsx tests/test-native.ts
 *
 * Expects binaries and models in ~/.cache/mvas/
 * Run `npx mvas setup` to download them.
 */

import { existsSync, writeFileSync } from 'fs';
import { NativeSTT, NativeLLM, NativeTTS, defaultPaths } from '../src/backends/native';
import type { AudioPlayable } from '../src/types';

// ============ Configuration ============

const CONFIG = {
  stt: {
    ...defaultPaths.whisper,
    language: 'en',
  },
  llm: {
    ...defaultPaths.llama,
    maxNewTokens: 50,
    temperature: 0.7,
    gpuLayers: 0,
  },
  tts: {
    ...defaultPaths.sherpaOnnxTts,
  },
};

// ============ Test Utilities ============

function log(msg: string): void {
  console.log(`\n${'='.repeat(60)}\n${msg}\n${'='.repeat(60)}`);
}

function pass(test: string): void {
  console.log(`✅ PASS: ${test}`);
}

function fail(test: string, error: unknown): void {
  console.log(`❌ FAIL: ${test}`);
  console.error(`   Error: ${error instanceof Error ? error.message : error}`);
}

function generateSpeechLikeAudio(durationSec: number = 3, sampleRate: number = 16000): Float32Array {
  // Generate audio that's more speech-like (multiple frequencies, varying amplitude)
  const samples = durationSec * sampleRate;
  const audio = new Float32Array(samples);

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    // Mix of frequencies typical in speech (100-300Hz fundamental + harmonics)
    const fundamental = 150 + Math.sin(t * 2) * 50; // Varying pitch
    const signal =
      Math.sin(2 * Math.PI * fundamental * t) * 0.4 +
      Math.sin(2 * Math.PI * fundamental * 2 * t) * 0.2 +
      Math.sin(2 * Math.PI * fundamental * 3 * t) * 0.1;

    // Add some amplitude variation
    const envelope = Math.sin(t * 3) * 0.3 + 0.7;
    audio[i] = signal * envelope * 0.5;
  }

  return audio;
}

// ============ Tests ============

async function testSTT(): Promise<boolean> {
  log('Testing STT (whisper.cpp)');

  try {
    // Check binary exists
    if (!existsSync(CONFIG.stt.binaryPath)) {
      fail('Binary exists', `Not found at ${CONFIG.stt.binaryPath}`);
      return false;
    }
    pass('Binary exists');

    // Check model exists
    if (!existsSync(CONFIG.stt.modelPath)) {
      fail('Model exists', `Not found at ${CONFIG.stt.modelPath}`);
      return false;
    }
    pass('Model exists');

    // Initialize pipeline
    const stt = new NativeSTT(CONFIG.stt);
    await stt.initialize();
    pass('Pipeline initialized');

    // Test transcription with synthetic audio
    console.log('\n   Transcribing synthetic audio (expect empty or noise interpretation)...');
    const testAudio = generateSpeechLikeAudio(2);
    const transcript = await stt.transcribe(testAudio);
    console.log(`   Transcript: "${transcript}"`);
    pass('Transcription completed');

    return true;
  } catch (error) {
    fail('STT test', error);
    return false;
  }
}

async function testLLM(): Promise<boolean> {
  log('Testing LLM (llama.cpp)');

  try {
    // Check binary exists
    if (!existsSync(CONFIG.llm.binaryPath)) {
      fail('Binary exists', `Not found at ${CONFIG.llm.binaryPath}`);
      return false;
    }
    pass('Binary exists');

    // Check model exists
    if (!existsSync(CONFIG.llm.modelPath)) {
      fail('Model exists', `Not found at ${CONFIG.llm.modelPath}`);
      return false;
    }
    pass('Model exists');

    // Initialize pipeline
    const llm = new NativeLLM(CONFIG.llm);
    await llm.initialize();
    pass('Pipeline initialized');

    // Test generation
    console.log('\n   Generating response...');
    const messages = [
      { role: 'system' as const, content: 'You are a helpful assistant. Be brief.' },
      { role: 'user' as const, content: 'Say hello in exactly 5 words.' },
    ];

    const tokens: string[] = [];
    const result = await llm.generate(messages, (token) => {
      tokens.push(token);
    });

    console.log(`   Response: "${result.trim()}"`);
    console.log(`   Tokens received: ${tokens.length}`);

    if (result.length > 0) {
      pass('Generation completed');
    } else {
      fail('Generation', 'Empty response');
      return false;
    }

    return true;
  } catch (error) {
    fail('LLM test', error);
    return false;
  }
}

async function testTTS(): Promise<boolean> {
  log('Testing TTS (sherpa-onnx)');

  try {
    // Check binary exists
    if (!existsSync(CONFIG.tts.binaryPath)) {
      fail('Binary exists', `Not found at ${CONFIG.tts.binaryPath}`);
      return false;
    }
    pass('Binary exists');

    // Check model directory exists
    if (!existsSync(CONFIG.tts.modelDir)) {
      fail('Model directory exists', `Not found at ${CONFIG.tts.modelDir}`);
      return false;
    }
    pass('Model directory exists');

    // Initialize pipeline
    const tts = new NativeTTS(CONFIG.tts);
    await tts.initialize();
    pass('Pipeline initialized');

    // Test synthesis
    console.log('\n   Synthesizing speech...');
    const testText = 'Hello, this is a test of the text to speech system.';
    const playable = await tts.synthesize(testText);

    // Get raw audio from the AudioPlayable
    const rawAudio = playable.getRawAudio();
    if (!rawAudio) {
      fail('Synthesis', 'No raw audio available');
      return false;
    }

    const { audio, sampleRate } = rawAudio;

    console.log(`   Text: "${testText}"`);
    console.log(`   Audio samples: ${audio.length}`);
    console.log(`   Sample rate: ${sampleRate}Hz`);
    console.log(`   Duration: ${(audio.length / sampleRate).toFixed(2)}s`);

    if (audio.length > 0) {
      pass('Synthesis completed');

      // Optionally save to file for manual verification
      const outputPath = '/tmp/tts-test-output.raw';
      const buffer = Buffer.alloc(audio.length * 2);
      for (let i = 0; i < audio.length; i++) {
        const sample = Math.max(-1, Math.min(1, audio[i]));
        buffer.writeInt16LE(Math.round(sample * 32767), i * 2);
      }
      writeFileSync(outputPath, buffer);
      console.log(`   Saved raw audio to: ${outputPath}`);
      console.log(`   Play with: ffplay -f s16le -ar ${sampleRate} -ac 1 ${outputPath}`);
    } else {
      fail('Synthesis', 'Empty audio output');
      return false;
    }

    return true;
  } catch (error) {
    fail('TTS test', error);
    return false;
  }
}

async function testEndToEnd(): Promise<boolean> {
  log('Testing End-to-End Pipeline');

  try {
    const { VoicePipeline } = await import('../src/voice-pipeline');

    const stt = new NativeSTT(CONFIG.stt);
    const llm = new NativeLLM(CONFIG.llm);
    const tts = new NativeTTS(CONFIG.tts);

    const pipeline = new VoicePipeline({
      stt,
      llm,
      tts,
      systemPrompt: 'You are a test assistant. Always respond with exactly: Test successful.',
    });

    await pipeline.initialize();
    pass('Pipeline initialized');

    // Process with synthetic audio
    console.log('\n   Processing synthetic audio through full pipeline...');

    let transcript = '';
    let response = '';
    let audioReceived = false;
    let completed = false;

    const testAudio = generateSpeechLikeAudio(2);

    await pipeline.processAudio(testAudio, {
      onTranscript: (text) => {
        transcript = text;
        console.log(`   Transcript: "${text}"`);
      },
      onResponseChunk: (chunk) => {
        response += chunk;
      },
      onAudio: (playable: AudioPlayable) => {
        audioReceived = true;
        const rawAudio = playable.getRawAudio();
        if (rawAudio) {
          console.log(`   Audio received: ${rawAudio.audio.length} samples @ ${rawAudio.sampleRate}Hz`);
        } else {
          console.log(`   Audio received (no raw data available)`);
        }
      },
      onComplete: () => {
        completed = true;
        console.log(`   Response: "${response.trim()}"`);
      },
      onError: (err) => {
        throw err;
      },
    });

    if (completed) {
      pass('End-to-end pipeline completed');
    } else {
      fail('End-to-end', 'Pipeline did not complete');
      return false;
    }

    return true;
  } catch (error) {
    fail('End-to-end test', error);
    return false;
  }
}

// ============ Main ============

async function main(): Promise<void> {
  console.log('\n🧪 Native Backend Test Suite\n');
  console.log('Configuration:');
  console.log(`  Whisper:      ${CONFIG.stt.binaryPath}`);
  console.log(`  Llama:        ${CONFIG.llm.binaryPath}`);
  console.log(`  Sherpa-ONNX:  ${CONFIG.tts.binaryPath}`);

  const results: Record<string, boolean> = {};

  // Run individual tests
  results.stt = await testSTT();
  results.llm = await testLLM();
  results.tts = await testTTS();

  // Run end-to-end only if all individual tests pass
  if (results.stt && results.llm && results.tts) {
    results.e2e = await testEndToEnd();
  } else {
    console.log('\n⚠️  Skipping end-to-end test due to earlier failures');
    results.e2e = false;
  }

  // Summary
  log('Test Summary');
  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  console.log(`\n  STT (whisper.cpp):   ${results.stt ? '✅' : '❌'}`);
  console.log(`  LLM (llama.cpp):     ${results.llm ? '✅' : '❌'}`);
  console.log(`  TTS (sherpa-onnx):   ${results.tts ? '✅' : '❌'}`);
  console.log(`  End-to-End:          ${results.e2e ? '✅' : '❌'}`);
  console.log(`\n  Total: ${passed}/${total} passed\n`);

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
