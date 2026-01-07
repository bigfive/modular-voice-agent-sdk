/**
 * Transformers.js TTS Pipeline
 * Isomorphic - works in browser (WebGPU) and Node.js
 *
 * Supports SpeechT5 and other TTS models from Hugging Face.
 */

import { pipeline } from '@huggingface/transformers';
import type { TTSPipeline, TransformersTTSConfig, ProgressCallback, AudioPlayable } from '../../types';
import { BufferedAudioPlayable } from '../../types';
import type { ModelStore } from '../../voice-pipeline';

export class TransformersTTS implements TTSPipeline {
  private config: TransformersTTSConfig;
  private modelStore: ModelStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;
  private ready = false;

  /**
   * @param config - TTS configuration
   * @param modelStore - Pipeline-scoped model store for caching.
   *   Models are cached here and shared across sessions within the same pipeline.
   */
  constructor(config: TransformersTTSConfig, modelStore: ModelStore) {
    this.config = config;
    this.modelStore = modelStore;
  }

  async initialize(onProgress?: ProgressCallback): Promise<void> {
    const cacheKey = `transformers-tts:${this.config.model}:${this.config.dtype}:${this.config.device ?? 'default'}`;

    if (this.modelStore.has(cacheKey)) {
      this.pipe = this.modelStore.get(cacheKey);
    } else {
      console.log(`Loading TTS model (${this.config.model})...`);
      this.pipe = await pipeline('text-to-speech', this.config.model, {
        dtype: this.config.dtype as 'fp32' | 'fp16' | 'q8' | 'q4',
        device: this.config.device,
        progress_callback: onProgress,
      });
      console.log('TTS model loaded.');
      this.modelStore.set(cacheKey, this.pipe);
    }

    this.ready = true;
  }

  async synthesize(text: string): Promise<AudioPlayable> {
    if (!this.pipe) {
      throw new Error('TTS pipeline not initialized');
    }

    const result = await this.pipe(text, {
      speaker_embeddings: this.config.speakerEmbeddings,
    });

    return new BufferedAudioPlayable(result.audio, result.sampling_rate);
  }

  isReady(): boolean {
    return this.ready;
  }
}

