/**
 * Native STT Pipeline (whisper.cpp)
 * Server-only - requires native binary
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import type { STTPipeline, NativeSTTConfig, ProgressCallback, TurnContext } from '../../types';

export class NativeSTT implements STTPipeline {
  private config: NativeSTTConfig;
  private ready = false;

  constructor(config: NativeSTTConfig) {
    this.config = config;
  }

  async initialize(_onProgress?: ProgressCallback): Promise<void> {
    console.log('Initializing native STT (whisper.cpp)...');

    if (!existsSync(this.config.binaryPath)) {
      throw new Error(`whisper.cpp binary not found at: ${this.config.binaryPath}`);
    }
    if (!existsSync(this.config.modelPath)) {
      throw new Error(`Whisper model not found at: ${this.config.modelPath}`);
    }

    this.ready = true;
    console.log('Native STT ready.');
  }

  async transcribe(audio: Float32Array, _turn?: TurnContext): Promise<string> {
    if (!this.ready) {
      throw new Error('STT pipeline not initialized');
    }

    const tempPath = join('/tmp', `whisper-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);

    try {
      this.writeWav(tempPath, audio, 16000);

      const result = execSync(
        `"${this.config.binaryPath}" ` +
        `-m "${this.config.modelPath}" ` +
        `-l ${this.config.language} ` +
        `--no-timestamps ` +
        `--suppress-nst ` +  // Suppress non-speech tokens like "(upbeat music)"
        `-np ` +             // No prints except results
        `-f "${tempPath}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );

      return result.trim();
    } finally {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  private writeWav(path: string, audio: Float32Array, sampleRate: number): void {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = audio.length * (bitsPerSample / 8);
    const fileSize = 36 + dataSize;

    const buffer = Buffer.alloc(44 + dataSize);
    let offset = 0;

    buffer.write('RIFF', offset); offset += 4;
    buffer.writeUInt32LE(fileSize, offset); offset += 4;
    buffer.write('WAVE', offset); offset += 4;
    buffer.write('fmt ', offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4;
    buffer.writeUInt16LE(1, offset); offset += 2;
    buffer.writeUInt16LE(numChannels, offset); offset += 2;
    buffer.writeUInt32LE(sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(byteRate, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
    buffer.write('data', offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;

    for (let i = 0; i < audio.length; i++) {
      const sample = Math.max(-1, Math.min(1, audio[i]));
      const int16 = sample < 0 ? sample * 32768 : sample * 32767;
      buffer.writeInt16LE(Math.round(int16), offset);
      offset += 2;
    }

    writeFileSync(path, buffer);
  }
}

