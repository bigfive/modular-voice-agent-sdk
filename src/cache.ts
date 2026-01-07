/**
 * Cache utilities for modular-voice-agent-sdk
 * Models and binaries are stored in ~/.cache/mvas/ by default
 */

import { homedir } from 'os';
import { join } from 'path';

/**
 * Get the cache directory for mvas assets.
 * Default: ~/.cache/mvas
 * Override with MVAS_CACHE environment variable.
 */
export function getCacheDir(): string {
  return process.env.MVAS_CACHE || join(homedir(), '.cache', 'mvas');
}

/**
 * Get the path to the models directory
 */
export function getModelsDir(): string {
  return join(getCacheDir(), 'models');
}

/**
 * Get the path to the binaries directory
 */
export function getBinDir(): string {
  return join(getCacheDir(), 'bin');
}

/**
 * Get the full path to a model file in the cache.
 * @param filename - The model filename (e.g., 'whisper-large-v3-turbo-q8.bin')
 */
export function getModelPath(filename: string): string {
  return join(getModelsDir(), filename);
}

/**
 * Get the full path to a binary in the cache.
 * @param name - The binary name (e.g., 'whisper-cli', 'llama-completion')
 */
export function getBinaryPath(name: string): string {
  return join(getBinDir(), name);
}

/**
 * Default binary names for native backends.
 */
export const defaultBinaries = {
  whisperCli: 'whisper-cli',
  llamaCompletion: 'llama-completion',
  sherpaOnnxTts: 'sherpa-onnx-offline-tts',
};
