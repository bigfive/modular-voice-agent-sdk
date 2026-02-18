/**
 * Programmatic Setup API for modular-voice-agent-sdk
 *
 * Provides the same download/verify/extract functionality as `npx mvas setup`
 * but as importable functions with progress callbacks.
 *
 * @example
 * ```typescript
 * import { setup, checkModelsInstalled } from 'modular-voice-agent-sdk/setup';
 *
 * if (!checkModelsInstalled('./models.json')) {
 *   await setup('./models.json', {
 *     onProgress: (event) => console.log(event.message),
 *   });
 * }
 * ```
 */

import { spawn, execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync, unlinkSync, statSync, createReadStream } from 'fs';
import { createHash } from 'crypto';
import { basename, join } from 'path';
import { getModelsDir } from './cache';
import type { ModelConfig, SetupConfig } from './setup-types';

// Re-export cache status utilities so consumers only need one import
export { checkModelsInstalled, getCacheStatus, getCacheDir, getModelsDir, getBinDir } from './cache';
export type { ModelConfig, SetupConfig, ModelStatus } from './setup-types';

// ============ Progress Event Types ============

export type SetupProgressEventType =
  | 'start'
  | 'model_start'
  | 'model_skip'
  | 'model_downloading'
  | 'model_resuming'
  | 'model_extracting'
  | 'model_verifying'
  | 'model_verification_failed'
  | 'model_done'
  | 'model_failed'
  | 'complete';

export interface SetupProgressEvent {
  type: SetupProgressEventType;
  message: string;
  model?: string;
  modelsDir?: string;
  /** Number of models processed so far */
  current?: number;
  /** Total number of models */
  total?: number;
}

export interface SetupModelResult {
  name: string;
  success: boolean;
  error?: string;
  skipped?: boolean;
}

export interface SetupResult {
  modelsDir: string;
  models: SetupModelResult[];
  succeeded: number;
  failed: number;
}

export interface SetupOptions {
  onProgress?: (event: SetupProgressEvent) => void;
}

// ============ Internal Helpers ============

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function verifyFile(filePath: string, config: ModelConfig): Promise<{ valid: boolean; reason?: string }> {
  if (!existsSync(filePath)) {
    return { valid: false, reason: 'file does not exist' };
  }

  const stats = statSync(filePath);

  if (config.size !== undefined) {
    if (stats.size !== config.size) {
      return {
        valid: false,
        reason: `size mismatch (got ${formatBytes(stats.size)}, expected ${formatBytes(config.size)})`,
      };
    }
  } else {
    if (stats.size < 1024 * 1024) {
      return { valid: false, reason: `file too small (${formatBytes(stats.size)})` };
    }
  }

  if (config.sha256) {
    const actualHash = await computeSha256(filePath);
    if (actualHash !== config.sha256.toLowerCase()) {
      return { valid: false, reason: 'checksum mismatch' };
    }
  }

  return { valid: true };
}

function downloadWithCurl(url: string, destPath: string, silent = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-L',
      '-C', '-',
      '-f',
      '-o', destPath,
      '--write-out', '\\nHTTP_CODE:%{http_code}\\n',
    ];

    if (!silent) {
      args.splice(3, 0, '--progress-bar');
    } else {
      args.splice(3, 0, '--silent', '--show-error');
    }

    args.push(url);

    const child = spawn('curl', args, {
      stdio: ['inherit', silent ? 'pipe' : 'inherit', 'pipe'],
    });

    let stderrData = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderrData += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0 || code === 33) {
        resolve();
      } else if (code === 22) {
        const httpMatch = stderrData.match(/HTTP_CODE:(\d+)/);
        const httpCode = httpMatch ? httpMatch[1] : 'unknown';
        reject(new Error(`HTTP error ${httpCode} - URL may be invalid or not found`));
      } else {
        reject(new Error(`curl exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to run curl: ${err.message}. Make sure curl is installed.`));
    });
  });
}

function extractArchive(archivePath: string, destDir: string): void {
  const ext = archivePath.toLowerCase();

  if (ext.endsWith('.tar.bz2') || ext.endsWith('.tbz2')) {
    execSync(`tar -xjf "${archivePath}" -C "${destDir}"`, { stdio: 'pipe' });
  } else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'pipe' });
  } else if (ext.endsWith('.zip')) {
    execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { stdio: 'pipe' });
  } else {
    throw new Error(`Unknown archive format: ${archivePath}`);
  }
}

// ============ Core Download Logic ============

async function downloadModel(
  type: string,
  config: ModelConfig,
  modelsDir: string,
  emit: (event: SetupProgressEvent) => void,
): Promise<SetupModelResult> {
  const url = config.url;
  const urlFilename = basename(new URL(url).pathname);

  if (config.extract) {
    const archivePath = join(modelsDir, urlFilename);
    const targetDir = config.directory || urlFilename.replace(/\.(tar\.bz2|tar\.gz|tbz2|tgz|zip)$/, '');
    const finalPath = join(modelsDir, targetDir);

    if (existsSync(finalPath)) {
      emit({ type: 'model_skip', message: `Already exists: ${targetDir}`, model: type });
      return { name: type, success: true, skipped: true };
    }

    emit({ type: 'model_downloading', message: `Downloading: ${url}`, model: type });

    if (existsSync(archivePath)) {
      const stats = statSync(archivePath);
      emit({ type: 'model_resuming', message: `Resuming from ${formatBytes(stats.size)}`, model: type });
    }

    await downloadWithCurl(url, archivePath);

    if (config.sha256 || config.size) {
      emit({ type: 'model_verifying', message: 'Verifying download...', model: type });
      const result = await verifyFile(archivePath, config);
      if (!result.valid) {
        emit({ type: 'model_verification_failed', message: `Verification failed: ${result.reason}, retrying...`, model: type });
        unlinkSync(archivePath);
        await downloadWithCurl(url, archivePath);
      }
    }

    emit({ type: 'model_extracting', message: `Extracting to: ${targetDir}`, model: type });
    extractArchive(archivePath, modelsDir);
    try { unlinkSync(archivePath); } catch { /* ignore */ }

    emit({ type: 'model_done', message: `Done: ${type}`, model: type });
    return { name: type, success: true };
  } else {
    const filename = config.filename || urlFilename;
    const destPath = join(modelsDir, filename);

    if (existsSync(destPath)) {
      const result = await verifyFile(destPath, config);
      if (result.valid) {
        emit({ type: 'model_skip', message: `Already exists: ${filename}`, model: type });
        return { name: type, success: true, skipped: true };
      }
      emit({ type: 'model_downloading', message: `Existing file invalid (${result.reason}), re-downloading...`, model: type });
    } else {
      emit({ type: 'model_downloading', message: `Downloading: ${url}`, model: type });
    }

    if (existsSync(destPath)) {
      const stats = statSync(destPath);
      emit({ type: 'model_resuming', message: `Resuming from ${formatBytes(stats.size)}`, model: type });
    }

    await downloadWithCurl(url, destPath);

    if (config.sha256 || config.size) {
      emit({ type: 'model_verifying', message: 'Verifying download...', model: type });
      const result = await verifyFile(destPath, config);
      if (!result.valid) {
        emit({ type: 'model_verification_failed', message: `Verification failed: ${result.reason}`, model: type });
        return { name: type, success: false, error: `Verification failed: ${result.reason}` };
      }
    }

    emit({ type: 'model_done', message: `Done: ${type}`, model: type });
    return { name: type, success: true };
  }
}

// ============ Public API ============

/**
 * Load and validate a setup config from a file path or object.
 */
export function loadConfig(configOrPath: string | SetupConfig): SetupConfig {
  let config: SetupConfig;

  if (typeof configOrPath === 'string') {
    if (!existsSync(configOrPath)) {
      throw new Error(`Config file not found: ${configOrPath}`);
    }
    const content = readFileSync(configOrPath, 'utf-8');
    try {
      config = JSON.parse(content);
    } catch {
      throw new Error(`Invalid JSON in config file: ${configOrPath}`);
    }
  } else {
    config = configOrPath;
  }

  if (!config.models || typeof config.models !== 'object') {
    throw new Error('Config must have a "models" object');
  }

  const modelTypes = Object.keys(config.models);
  if (modelTypes.length === 0) {
    throw new Error('No models defined in config');
  }

  return config;
}

/**
 * Download and set up models defined in a config file or object.
 * This is the programmatic equivalent of `npx mvas setup <config.json>`.
 *
 * @param configOrPath - A SetupConfig object, or a path to a JSON config file
 * @param options - Optional callbacks for progress reporting
 * @returns Result summary with per-model status
 */
export async function setup(
  configOrPath: string | SetupConfig,
  options?: SetupOptions,
): Promise<SetupResult> {
  const config = loadConfig(configOrPath);
  const emit = options?.onProgress ?? (() => {});

  const curlCheck = spawnSync('curl', ['--version']);
  if (curlCheck.error) {
    throw new Error('curl is required but not found. Please install curl.');
  }

  const modelsDir = getModelsDir();
  mkdirSync(modelsDir, { recursive: true });

  const modelTypes = Object.keys(config.models);

  emit({
    type: 'start',
    message: `Setting up ${modelTypes.length} model(s)`,
    modelsDir,
    total: modelTypes.length,
  });

  const results: SetupModelResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < modelTypes.length; i++) {
    const type = modelTypes[i];
    const modelConfig = config.models[type];

    emit({
      type: 'model_start',
      message: `${type.toUpperCase()} model`,
      model: type,
      current: i + 1,
      total: modelTypes.length,
    });

    try {
      const result = await downloadModel(type, modelConfig, modelsDir, emit);
      results.push(result);
      if (result.success) succeeded++;
      else failed++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      emit({
        type: 'model_failed',
        message: `Failed: ${errorMsg}`,
        model: type,
        current: i + 1,
        total: modelTypes.length,
      });
      results.push({ name: type, success: false, error: errorMsg });
      failed++;
    }
  }

  emit({
    type: 'complete',
    message: `Setup complete: ${succeeded} succeeded, ${failed} failed`,
    modelsDir,
    total: modelTypes.length,
  });

  return { modelsDir, models: results, succeeded, failed };
}

/**
 * Set up native binaries (whisper-cli, llama-completion, sherpa-onnx-offline-tts).
 * Runs the bundled setup-binaries.sh script.
 *
 * @param sdkDir - Path to the SDK package directory (containing scripts/).
 *                 If not provided, assumes the script is at ../scripts/ relative to this file.
 */
export async function setupBinaries(sdkDir?: string): Promise<void> {
  const scriptsBase = sdkDir ?? join(import.meta.dirname ?? '.', '..');
  const scriptPath = join(scriptsBase, 'scripts', 'setup-binaries.sh');
  const originalScript = join(scriptsBase, 'scripts', 'setup.sh');
  const targetScript = existsSync(scriptPath) ? scriptPath : originalScript;

  if (!existsSync(targetScript)) {
    throw new Error(`Setup script not found at: ${scriptPath}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('bash', [targetScript, '--binaries-only'], {
      stdio: 'inherit',
    });

    child.on('error', (err) => {
      if (err.message.includes('ENOENT')) {
        reject(new Error(`bash not found. Please run the setup script manually: bash ${targetScript}`));
      } else {
        reject(new Error(`Error running setup: ${err.message}`));
      }
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Setup script exited with code ${code}`));
      }
      resolve();
    });
  });
}
