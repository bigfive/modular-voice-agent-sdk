/**
 * Native TTS Pipeline (sherpa-onnx)
 * Server-only - requires sherpa-onnx binary
 *
 * Uses sherpa-onnx-offline-tts which supports multiple model types via providers.
 * See: https://github.com/k2-fsa/sherpa-onnx
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { TTSPipeline, SherpaOnnxTTSConfig, ProgressCallback, AudioResult, AudioPlayable } from '../../types';
import { BufferedAudioPlayable } from '../../types';
import { TTSModelProvider, PiperTTSProvider } from './tts-providers';

export class NativeTTS implements TTSPipeline {
  private config: SherpaOnnxTTSConfig;
  private provider: TTSModelProvider;
  private ready = false;

  constructor(config: SherpaOnnxTTSConfig, provider?: TTSModelProvider) {
    this.config = {
      speakerId: 0,
      speedScale: 1.0,
      ...config,
    };
    this.provider = provider || new PiperTTSProvider();
  }

  async initialize(_onProgress?: ProgressCallback): Promise<void> {
    if (!existsSync(this.config.binaryPath)) {
      throw new Error(`sherpa-onnx-offline-tts binary not found at: ${this.config.binaryPath}`);
    }
    if (!existsSync(this.config.modelDir)) {
      throw new Error(`TTS model directory not found at: ${this.config.modelDir}`);
    }

    this.provider.validate(this.config.modelDir);

    this.ready = true;
  }

  async synthesize(text: string): Promise<AudioPlayable> {
    if (!this.ready) {
      throw new Error('TTS pipeline not initialized');
    }

    // sherpa-onnx outputs to a file, so we use a temp file
    const tmpFile = join(tmpdir(), `sherpa-tts-${Date.now()}.wav`);

    try {
      const escapedText = text.replace(/'/g, "'\\''");

      // Build command using provider
      const baseCmd = this.provider.buildCommand({
        binaryPath: this.config.binaryPath,
        modelDir: this.config.modelDir,
        speakerId: this.config.speakerId ?? 0,
        outputFile: tmpFile,
        numThreads: this.config.numThreads,
      });

      const cmd = `${baseCmd} '${escapedText}'`;

      execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });

      // Read the WAV file and extract PCM data
      const wavBuffer = readFileSync(tmpFile);
      const { audio, sampleRate } = this.parseWav(wavBuffer);

      return new BufferedAudioPlayable(audio, sampleRate);
    } finally {
      // Clean up temp file
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    }
  }

  private parseWav(buffer: Buffer): AudioResult {
    // Simple WAV parser - assumes 16-bit PCM
    // WAV header is typically 44 bytes
    const dataOffset = buffer.indexOf(Buffer.from('data')) + 8;
    const sampleRate = buffer.readUInt32LE(24);
    const bitsPerSample = buffer.readUInt16LE(34);

    if (bitsPerSample !== 16) {
      throw new Error(`Unsupported bits per sample: ${bitsPerSample}`);
    }

    const pcmData = buffer.subarray(dataOffset);
    const int16 = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
    const float32 = new Float32Array(int16.length);

    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    return { audio: float32, sampleRate };
  }

  isReady(): boolean {
    return this.ready;
  }
}
