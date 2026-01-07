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

// ============ Runtime Model Cache ============

/**
 * Runtime cache for loaded models/resources.
 * Backends use this to share heavy resources (models, tokenizers) across sessions.
 * The cache is keyed by a unique string identifier (e.g., "transformers-llm:model-name:dtype").
 */
const runtimeCache = new Map<string, unknown>();

/**
 * Get a cached resource, or load it if not cached.
 * @param key - Unique cache key
 * @param loader - Async function to load the resource if not cached
 * @returns The cached or newly loaded resource
 */
export async function getCachedOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
  if (runtimeCache.has(key)) {
    return runtimeCache.get(key) as T;
  }
  const resource = await loader();
  runtimeCache.set(key, resource);
  return resource;
}

/**
 * Check if a resource is in the cache.
 */
export function isCached(key: string): boolean {
  return runtimeCache.has(key);
}

/**
 * Clear a specific cached resource.
 */
export function clearCached(key: string): void {
  runtimeCache.delete(key);
}

/**
 * Clear all cached resources.
 */
export function clearAllCached(): void {
  runtimeCache.clear();
}
