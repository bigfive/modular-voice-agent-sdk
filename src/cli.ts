#!/usr/bin/env node
/**
 * Modular Voice Agent SDK CLI
 *
 * Thin wrapper around the programmatic setup API.
 *
 * Usage:
 *   npx mvas setup <config.json>   - Download models from config file
 *   npx mvas setup --binaries-only - Set up native binaries only
 *   npx mvas help                  - Show help
 */

import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getCacheDir, getModelsDir } from './cache';
import { setup, setupBinaries } from './setup';
import type { SetupProgressEvent } from './setup';

// ============ CLI Progress Reporter ============

function cliProgressReporter(event: SetupProgressEvent): void {
  switch (event.type) {
    case 'start':
      console.log('Modular Voice Agent SDK Setup');
      console.log('====================');
      console.log(`Models directory: ${event.modelsDir}`);
      break;
    case 'model_start':
      console.log(`\n==> ${event.model?.toUpperCase()} model`);
      break;
    case 'model_skip':
      console.log(`    ✓ ${event.message}`);
      break;
    case 'model_downloading':
      console.log(`    ${event.message}`);
      break;
    case 'model_resuming':
      console.log(`    ${event.message}`);
      break;
    case 'model_extracting':
      console.log(`    ${event.message}`);
      break;
    case 'model_verifying':
      console.log(`    ${event.message}`);
      break;
    case 'model_verification_failed':
      console.log(`    ⚠️  ${event.message}`);
      break;
    case 'model_done':
      console.log(`    ✓ Done!`);
      break;
    case 'model_failed':
      console.error(`    ❌ ${event.message}`);
      break;
    case 'complete':
      console.log('\n============================================================');
      console.log('Setup complete!');
      console.log('============================================================');
      break;
  }
}

// ============ Helpers ============

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ============ Commands ============

async function setupFromConfig(configPath: string): Promise<void> {
  console.log(`Config: ${configPath}`);

  const result = await setup(configPath, { onProgress: cliProgressReporter });

  const modelsDir = getModelsDir();
  console.log(`\nModels location: ${modelsDir}`);

  const files = readdirSync(modelsDir);
  if (files.length > 0) {
    console.log('\nDownloaded models:');
    for (const file of files) {
      const filePath = join(modelsDir, file);
      const stats = statSync(filePath);
      const size = stats.isDirectory() ? '(dir)' : formatBytes(stats.size);
      console.log(`  - ${file} ${size}`);
    }
  }

  if (result.failed > 0) {
    console.error(`\n⚠️  ${result.failed} download(s) failed:`);
    for (const m of result.models) {
      if (!m.success) {
        console.error(`   - ${m.name}: ${m.error}`);
      }
    }
  }

  console.log('\n💡 To set up native binaries (whisper-cli, llama-completion, llama-mtmd-cli, sherpa-onnx):');
  console.log('   npx mvas setup --binaries-only');
}

async function runSetupBinaries(): Promise<void> {
  console.log('Setting up native binaries...');
  console.log('This will configure: whisper-cli, llama-completion, llama-mtmd-cli, sherpa-onnx');
  console.log('');

  try {
    await setupBinaries();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ============ Help ============

function printHelp(): void {
  console.log(`
mvas - Modular Voice Agent SDK CLI

Commands:
  setup <config.json>     Download models specified in config file
  setup --binaries-only   Set up native binaries (whisper-cli, llama-completion, llama-mtmd-cli, sherpa-onnx)
  help                    Show this help message

Config file format (JSON):
  {
    "models": {
      "stt": {
        "url": "https://huggingface.co/.../model.bin",
        "filename": "whisper-model.bin",
        "size": 874123456,
        "sha256": "abc123..."
      },
      "llm": {
        "url": "https://huggingface.co/.../model.gguf",
        "filename": "llm-model.gguf"
      },
      "tts": {
        "url": "https://github.com/.../model.tar.bz2",
        "extract": true,
        "directory": "tts-model"
      }
    }
  }

  Note: Model keys can be anything (stt, llm, tts, audioLLM, projector, etc.)

Options for each model:
  url         - Download URL (required)
  filename    - Local filename (defaults to URL filename)
  size        - Expected file size in bytes (for verification)
  sha256      - Expected SHA256 hash (for verification)
  extract     - Set to true for archives (.tar.bz2, .tar.gz, .zip)
  directory   - Directory name after extraction

Features:
  • Automatic resume of interrupted downloads
  • File integrity verification (size + optional SHA256)
  • Skips already-downloaded valid files

Examples:
  npx mvas setup ./models.json           # Download models from config
  npx mvas setup --binaries-only         # Just set up native binaries

Cache location: ${getCacheDir()}
  Override with: export MVAS_CACHE=/path/to/cache

For more info: https://github.com/bigfive/modular-voice-agent-sdk
`);
}

// ============ Main ============

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'setup': {
      const arg = args[1];

      if (!arg) {
        console.error('Error: setup requires a config file or --binaries-only flag');
        console.error('');
        console.error('Usage:');
        console.error('  npx mvas setup <config.json>');
        console.error('  npx mvas setup --binaries-only');
        process.exit(1);
      }

      if (arg === '--binaries-only' || arg === '--binaries') {
        await runSetupBinaries();
      } else {
        await setupFromConfig(arg);
      }
      break;
    }

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
