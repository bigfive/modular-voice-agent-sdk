/**
 * Transformers.js STT Pipeline
 * Isomorphic - works in browser (WebGPU) and Node.js
 *
 * Supports Whisper, Moonshine, Wav2Vec2, and other ASR models from Hugging Face.
 */

import { pipeline } from '@huggingface/transformers';
import type { STTPipeline, TransformersSTTConfig, ProgressCallback, TurnContext } from '../../types';
import { getCachedOrLoad } from '../../cache-runtime';
import type { ModelStore } from '../../voice-pipeline';

export class TransformersSTT implements STTPipeline {
  private config: TransformersSTTConfig;
  private modelStore?: ModelStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;
  private ready = false;

  /**
   * @param config - STT configuration
   * @param modelStore - Optional pipeline-scoped model store for caching.
   *   If provided, uses this instead of global cache. Recommended for production.
   */
  constructor(config: TransformersSTTConfig, modelStore?: ModelStore) {
    this.config = config;
    this.modelStore = modelStore;
  }

  async initialize(onProgress?: ProgressCallback): Promise<void> {
    const cacheKey = `transformers-stt:${this.config.model}:${this.config.dtype}:${this.config.device ?? 'default'}`;

    // Use pipeline-scoped store if provided, otherwise fall back to global cache
    if (this.modelStore) {
      if (this.modelStore.has(cacheKey)) {
        this.pipe = this.modelStore.get(cacheKey);
      } else {
        console.log(`Loading STT model (${this.config.model})...`);
        this.pipe = await pipeline('automatic-speech-recognition', this.config.model, {
          dtype: this.config.dtype as 'fp32' | 'fp16' | 'q8' | 'q4',
          device: this.config.device,
          progress_callback: onProgress,
        });
        console.log('STT model loaded.');
        this.modelStore.set(cacheKey, this.pipe);
      }
    } else {
      // Fallback to global cache for backwards compatibility
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
    }

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

