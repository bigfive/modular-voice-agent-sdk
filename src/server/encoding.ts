/**
 * Server-side Audio Encoding Utilities
 *
 * Uses Node.js Buffer for better performance than browser-based encoding.
 */

import type { AudioResult } from '../types';

/**
 * Encode raw PCM audio (Float32Array + sampleRate) into a WAV file Buffer.
 * Produces a standard 16-bit mono PCM WAV suitable for storage or transport.
 */
export function encodeWav(audio: Float32Array, sampleRate: number): Buffer;
export function encodeWav(audioResult: AudioResult): Buffer;
export function encodeWav(audioOrResult: Float32Array | AudioResult, maybeSampleRate?: number): Buffer {
  let audio: Float32Array;
  let sampleRate: number;

  if (audioOrResult instanceof Float32Array) {
    audio = audioOrResult;
    sampleRate = maybeSampleRate!;
  } else {
    audio = audioOrResult.audio;
    sampleRate = audioOrResult.sampleRate;
  }

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = audio.length * (bitsPerSample / 8);
  const headerSize = 44;

  const buffer = Buffer.alloc(headerSize + dataSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(headerSize - 8 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // fmt chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;            // chunk size
  buffer.writeUInt16LE(1, offset); offset += 2;             // PCM format
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // Convert Float32 [-1.0, 1.0] to Int16 [-32768, 32767]
  for (let i = 0; i < audio.length; i++) {
    const clamped = Math.max(-1, Math.min(1, audio[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }

  return buffer;
}

/**
 * Encode Float32Array to base64 string (Node.js optimized)
 */
export function float32ToBase64Node(audio: Float32Array): string {
  // Create a new buffer and copy data to ensure alignment
  const buffer = Buffer.alloc(audio.length * 4);
  for (let i = 0; i < audio.length; i++) {
    buffer.writeFloatLE(audio[i], i * 4);
  }
  return buffer.toString('base64');
}

/**
 * Decode base64 string to Float32Array (Node.js optimized)
 */
export function base64ToFloat32Node(data: string): Float32Array {
  const buffer = Buffer.from(data, 'base64');
  const float32 = new Float32Array(buffer.length / 4);
  for (let i = 0; i < float32.length; i++) {
    float32[i] = buffer.readFloatLE(i * 4);
  }
  return float32;
}

/**
 * Concatenate multiple Float32Arrays into one
 */
export function concatFloat32Arrays(arrays: Float32Array[]): Float32Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

