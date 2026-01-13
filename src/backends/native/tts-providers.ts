/**
 * TTS Model Providers
 * Abstracts model-specific CLI arguments for sherpa-onnx-offline-tts
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface TTSModelContext {
  binaryPath: string;
  modelDir: string;
  speakerId: number;
  outputFile: string;
  numThreads?: number;
}

/**
 * TTSModelProvider interface
 * Providers implement model-specific CLI argument formatting
 */
export interface TTSModelProvider {
  /** Human-readable name for logging */
  readonly name: string;

  /**
   * Validate model directory has required files
   * @throws Error if required files are missing
   */
  validate(modelDir: string): void;

  /**
   * Build the CLI command arguments (without the text)
   * @returns Command string ready for text to be appended
   */
  buildCommand(ctx: TTSModelContext): string;
}

// ============================================================================
// Piper Provider (VITS models)
// ============================================================================

export class PiperTTSProvider implements TTSModelProvider {
  readonly name = 'Piper VITS';

  validate(modelDir: string): void {
    // Find .onnx file
    const onnxFiles = readdirSync(modelDir)
      .filter(f => f.endsWith('.onnx') && !f.endsWith('.onnx.json'));
    if (onnxFiles.length === 0) {
      throw new Error(`No .onnx model file found in: ${modelDir}`);
    }

    // Check for tokens.txt
    const tokensPath = join(modelDir, 'tokens.txt');
    if (!existsSync(tokensPath)) {
      throw new Error(`tokens.txt not found in: ${modelDir}`);
    }

    // Check for espeak-ng-data
    const dataDir = join(modelDir, 'espeak-ng-data');
    if (!existsSync(dataDir)) {
      throw new Error(`espeak-ng-data directory not found in: ${modelDir}`);
    }
  }

  buildCommand(ctx: TTSModelContext): string {
    const onnxFiles = readdirSync(ctx.modelDir)
      .filter(f => f.endsWith('.onnx') && !f.endsWith('.onnx.json'));
    const modelPath = join(ctx.modelDir, onnxFiles[0]);
    const tokensPath = join(ctx.modelDir, 'tokens.txt');
    const dataDir = join(ctx.modelDir, 'espeak-ng-data');

    const threads = ctx.numThreads ?? 4;
    return (
      `"${ctx.binaryPath}" ` +
      `--num-threads=${threads} ` +
      `--vits-model="${modelPath}" ` +
      `--vits-tokens="${tokensPath}" ` +
      `--vits-data-dir="${dataDir}" ` +
      `--sid=${ctx.speakerId} ` +
      `--output-filename="${ctx.outputFile}"`
    );
  }
}

// ============================================================================
// Kokoro Provider
// ============================================================================

export class KokoroTTSProvider implements TTSModelProvider {
  readonly name = 'Kokoro';

  private lexiconFile?: string;

  /**
   * @param lexiconFile Optional lexicon file name (e.g., 'lexicon-gb-en.txt')
   *                    If not provided, will look for lexicon-us-en.txt or lexicon-gb-en.txt
   */
  constructor(lexiconFile?: string) {
    this.lexiconFile = lexiconFile;
  }

  validate(modelDir: string): void {
    const required = [
      'model.onnx',
      'voices.bin',
      'tokens.txt',
      'espeak-ng-data',
    ];

    for (const file of required) {
      const path = join(modelDir, file);
      if (!existsSync(path)) {
        throw new Error(`Required file not found: ${path}`);
      }
    }
  }

  buildCommand(ctx: TTSModelContext): string {
    const modelPath = join(ctx.modelDir, 'model.onnx');
    const voicesPath = join(ctx.modelDir, 'voices.bin');
    const tokensPath = join(ctx.modelDir, 'tokens.txt');
    const dataDir = join(ctx.modelDir, 'espeak-ng-data');

    // Find lexicon file
    const lexiconPath = this.findLexicon(ctx.modelDir);

    const threads = ctx.numThreads ?? 4;
    let cmd =
      `"${ctx.binaryPath}" ` +
      `--num-threads=${threads} ` +
      `--kokoro-model="${modelPath}" ` +
      `--kokoro-voices="${voicesPath}" ` +
      `--kokoro-tokens="${tokensPath}" ` +
      `--kokoro-data-dir="${dataDir}" `;

    if (lexiconPath) {
      cmd += `--kokoro-lexicon="${lexiconPath}" `;
    }

    cmd +=
      `--sid=${ctx.speakerId} ` +
      `--output-filename="${ctx.outputFile}"`;

    return cmd;
  }

  private findLexicon(modelDir: string): string | undefined {
    // Use explicit lexicon if provided
    if (this.lexiconFile) {
      const path = join(modelDir, this.lexiconFile);
      return existsSync(path) ? path : undefined;
    }

    // Otherwise try common lexicon files
    const candidates = ['lexicon-us-en.txt', 'lexicon-gb-en.txt'];
    for (const file of candidates) {
      const path = join(modelDir, file);
      if (existsSync(path)) {
        return path;
      }
    }

    return undefined;
  }
}
