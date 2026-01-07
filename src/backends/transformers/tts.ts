/**
 * Transformers.js TTS Pipeline
 * Isomorphic - works in browser (WebGPU) and Node.js
 *
 * Supports SpeechT5 and other TTS models from Hugging Face.
 */

import { pipeline } from '@huggingface/transformers';
import type { TTSPipeline, TransformersTTSConfig, ProgressCallback, AudioPlayable } from '../../types';
import { BufferedAudioPlayable } from '../../types';
import { getCachedOrLoad } from '../../cache-runtime';

export class TransformersTTS implements TTSPipeline {
  private config: TransformersTTSConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;
  private ready = false;

  constructor(config: TransformersTTSConfig) {
    this.config = config;
  }

  async initialize(onProgress?: ProgressCallback): Promise<void> {
    const cacheKey = `transformers-tts:${this.config.model}:${this.config.dtype}:${this.config.device ?? 'default'}`;

    this.pipe = await getCachedOrLoad(cacheKey, async () => {
      console.log(`Loading TTS model (${this.config.model})...`);
      const pipe = await pipeline('text-to-speech', this.config.model, {
        dtype: this.config.dtype as 'fp32' | 'fp16' | 'q8' | 'q4',
        device: this.config.device,
        progress_callback: onProgress,
      });
      console.log('TTS model loaded.');
      return pipe;
    });

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

