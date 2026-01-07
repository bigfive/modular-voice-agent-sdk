/**
 * Transformers.js STT Pipeline
 * Isomorphic - works in browser (WebGPU) and Node.js
 *
 * Supports Whisper, Moonshine, Wav2Vec2, and other ASR models from Hugging Face.
 */

import { pipeline } from '@huggingface/transformers';
import type { STTPipeline, TransformersSTTConfig, ProgressCallback, TurnContext } from '../../types';
import { getCachedOrLoad } from '../../cache';

export class TransformersSTT implements STTPipeline {
  private config: TransformersSTTConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;
  private ready = false;

  constructor(config: TransformersSTTConfig) {
    this.config = config;
  }

  async initialize(onProgress?: ProgressCallback): Promise<void> {
    const cacheKey = `transformers-stt:${this.config.model}:${this.config.dtype}:${this.config.device ?? 'default'}`;

    this.pipe = await getCachedOrLoad(cacheKey, async () => {
      console.log(`Loading STT model (${this.config.model})...`);
      const pipe = await pipeline('automatic-speech-recognition', this.config.model, {
        dtype: this.config.dtype as 'fp32' | 'fp16' | 'q8' | 'q4',
        device: this.config.device,
        progress_callback: onProgress,
      });
      console.log('STT model loaded.');
      return pipe;
    });

    this.ready = true;
  }

  async transcribe(audio: Float32Array, _turn?: TurnContext): Promise<string> {
    if (!this.pipe) {
      throw new Error('STT pipeline not initialized');
    }

    const options = this.config.language
      ? { language: this.config.language, task: 'transcribe' as const }
      : {};

    const result = await this.pipe(audio, options);

    if (Array.isArray(result)) {
      return result[0]?.text?.trim() || '';
    }
    return (result as { text: string }).text?.trim() || '';
  }

  isReady(): boolean {
    return this.ready;
  }
}

