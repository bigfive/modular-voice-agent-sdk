/**
 * Cache utilities for modular-voice-agent-sdk
 * Models and binaries are stored in ~/.cache/mvas/ by default
 *
 * NOTE: This module uses Node.js APIs (os, path) and is SERVER-ONLY.
 * For browser model caching, use the ModelStore passed to backend constructors.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';
import type { SetupConfig, ModelConfig, ModelStatus } from './setup-types';

export type { ModelConfig, SetupConfig, ModelStatus } from './setup-types';

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

function resolveModelPath(config: ModelConfig): string {
  const urlFilename = basename(new URL(config.url).pathname);

  if (config.extract) {
    const targetDir = config.directory || urlFilename.replace(/\.(tar\.bz2|tar\.gz|tbz2|tgz|zip)$/, '');
    return join(getModelsDir(), targetDir);
  }

  return join(getModelsDir(), config.filename || urlFilename);
}

/**
 * Check the installation status of all models defined in a setup config.
 * Returns per-model status indicating whether each is installed and its expected path.
 *
 * @param configOrPath - A SetupConfig object, or a path to a JSON config file
 */
export function getCacheStatus(configOrPath: string | SetupConfig): ModelStatus[] {
  let config: SetupConfig;

  if (typeof configOrPath === 'string') {
    const content = readFileSync(configOrPath, 'utf-8');
    config = JSON.parse(content);
  } else {
    config = configOrPath;
  }

  if (!config.models || typeof config.models !== 'object') {
    throw new Error('Config must have a "models" object');
  }

  return Object.entries(config.models).map(([name, modelConfig]) => {
    const expectedPath = resolveModelPath(modelConfig);
    return {
      name,
      installed: existsSync(expectedPath),
      path: expectedPath,
      expectedFilename: modelConfig.filename || basename(new URL(modelConfig.url).pathname),
    };
  });
}

/**
 * Check whether all models in a setup config are installed.
 *
 * @param configOrPath - A SetupConfig object, or a path to a JSON config file
 * @returns true if every model is present on disk
 */
export function checkModelsInstalled(configOrPath: string | SetupConfig): boolean {
  return getCacheStatus(configOrPath).every((m) => m.installed);
}
