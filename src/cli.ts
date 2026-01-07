#!/usr/bin/env node
/**
 * Modular Voice Agent SDK CLI
 *
 * Usage:
 *   npx mvas setup <config.json>   - Download models from config file
 *   npx mvas setup --binaries-only - Set up native binaries only
 *   npx mvas help                  - Show help
 */

import { spawn, execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync, unlinkSync, readdirSync, statSync, createReadStream } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============ Config Types ============

interface ModelConfig {
  url: string;
  filename?: string;      // For single files
  extract?: boolean;      // For archives
  directory?: string;     // Directory name after extraction
  sha256?: string;        // Expected SHA256 hash (optional, for verification)
  size?: number;          // Expected file size in bytes (optional, for quick check)
}

interface SetupConfig {
  models: {
    stt?: ModelConfig;
    llm?: ModelConfig;
    tts?: ModelConfig;
  };
}

// ============ Cache Paths ============

function getCacheDir(): string {
  return process.env.MVAS_CACHE || join(homedir(), '.cache', 'mvas');
}

function getModelsDir(): string {
  return join(getCacheDir(), 'models');
}

// ============ Hash Verification ============

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

  // Check size if provided
  if (config.size !== undefined) {
    if (stats.size !== config.size) {
      return {
        valid: false,
        reason: `size mismatch (got ${formatBytes(stats.size)}, expected ${formatBytes(config.size)})`
      };
    }
  } else {
    // No size specified - check if file is suspiciously small (< 1MB for models)
    if (stats.size < 1024 * 1024) {
      return { valid: false, reason: `file too small (${formatBytes(stats.size)})` };
    }
  }

  // Check hash if provided
  if (config.sha256) {
    console.log('    Verifying checksum...');
    const actualHash = await computeSha256(filePath);
    if (actualHash !== config.sha256.toLowerCase()) {
      return {
        valid: false,
        reason: `checksum mismatch`
      };
    }
  }

  return { valid: true };
}

// ============ Download Helpers ============

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Download a file using curl with resume support.
 * curl -C - automatically resumes partial downloads.
 */
function downloadWithCurl(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if partial file exists
    const isResume = existsSync(destPath);
    if (isResume) {
      const stats = statSync(destPath);
      console.log(`    Resuming from ${formatBytes(stats.size)}...`);
    }

    // curl with:
    // -L: follow redirects
    // -C -: auto-resume from where it left off
    // --progress-bar: show progress
    // -o: output file
    const child = spawn('curl', [
      '-L',
      '-C', '-',
      '--progress-bar',
      '-o', destPath,
      url
    ], {
      stdio: ['inherit', 'inherit', 'inherit'],
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else if (code === 33) {
        // curl exit 33 = range request not supported, but file may be complete
        // Check if this is because file is already complete
        resolve();
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
    execSync(`tar -xjf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' });
  } else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' });
  } else if (ext.endsWith('.zip')) {
    execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { stdio: 'inherit' });
  } else {
    throw new Error(`Unknown archive format: ${archivePath}`);
  }
}

// ============ Model Download ============

async function downloadModel(type: string, config: ModelConfig, modelsDir: string): Promise<void> {
  console.log(`\n==> ${type.toUpperCase()} model`);

  const url = config.url;
  const urlFilename = basename(new URL(url).pathname);

  if (config.extract) {
    // Archive - download, extract, cleanup
    const archivePath = join(modelsDir, urlFilename);
    const targetDir = config.directory || urlFilename.replace(/\.(tar\.bz2|tar\.gz|tbz2|tgz|zip)$/, '');
    const finalPath = join(modelsDir, targetDir);

    if (existsSync(finalPath)) {
      console.log(`    ✓ Already exists: ${targetDir}`);
      return;
    }

    console.log(`    Downloading: ${url}`);
    console.log(`    Extracting to: ${targetDir}`);

    await downloadWithCurl(url, archivePath);

    // Verify archive if hash provided
    if (config.sha256 || config.size) {
      const result = await verifyFile(archivePath, config);
      if (!result.valid) {
        console.log(`    ⚠️  Verification failed: ${result.reason}`);
        console.log(`    Deleting partial file and retrying...`);
        unlinkSync(archivePath);
        await downloadWithCurl(url, archivePath);
      }
    }

    extractArchive(archivePath, modelsDir);

    // Cleanup archive
    try { unlinkSync(archivePath); } catch { /* ignore */ }

    console.log(`    ✓ Done!`);
  } else {
    // Single file
    const filename = config.filename || urlFilename;
    const destPath = join(modelsDir, filename);

    // Check if file exists and is valid
    if (existsSync(destPath)) {
      const result = await verifyFile(destPath, config);
      if (result.valid) {
        console.log(`    ✓ Already exists: ${filename}`);
        return;
      }
      console.log(`    Existing file invalid: ${result.reason}`);
      console.log(`    Re-downloading...`);
    }

    console.log(`    URL: ${url}`);
    console.log(`    Saving as: ${filename}`);
    if (config.size) {
      console.log(`    Expected size: ${formatBytes(config.size)}`);
    }

    await downloadWithCurl(url, destPath);

    // Verify after download
    if (config.sha256 || config.size) {
      const result = await verifyFile(destPath, config);
      if (!result.valid) {
        console.log(`    ⚠️  Verification failed: ${result.reason}`);
        console.log(`    You may need to delete the file and re-run setup.`);
        return;
      }
      if (config.sha256) {
        console.log(`    ✓ Checksum verified`);
      }
    }

    console.log(`    ✓ Done!`);
  }
}

async function setupFromConfig(configPath: string): Promise<void> {
  if (!existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    process.exit(1);
  }

  let config: SetupConfig;
  try {
    const content = readFileSync(configPath, 'utf-8');
    config = JSON.parse(content);
  } catch (err) {
    console.error(`Error: Invalid JSON in config file: ${configPath}`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (!config.models || typeof config.models !== 'object') {
    console.error('Error: Config must have a "models" object');
    process.exit(1);
  }

  // Check curl is available
  const curlCheck = spawnSync('curl', ['--version']);
  if (curlCheck.error) {
    console.error('Error: curl is required but not found. Please install curl.');
    process.exit(1);
  }

  const modelsDir = getModelsDir();
  mkdirSync(modelsDir, { recursive: true });

  console.log('Modular Voice Agent SDK Setup');
  console.log('====================');
  console.log(`Config: ${configPath}`);
  console.log(`Models directory: ${modelsDir}`);

  const modelTypes = ['stt', 'llm', 'tts'] as const;

  for (const type of modelTypes) {
    const modelConfig = config.models[type];
    if (modelConfig) {
      await downloadModel(type, modelConfig, modelsDir);
    }
  }

  console.log('\n============================================================');
  console.log('Setup complete!');
  console.log('============================================================');
  console.log(`\nModels location: ${modelsDir}`);

  // List what's there with sizes
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

  console.log('\n💡 To set up native binaries (whisper-cli, llama-completion, sherpa-onnx):');
  console.log('   npx mvas setup --binaries-only');
}

// ============ Binaries Setup ============

async function setupBinaries(): Promise<void> {
  // Find and run the setup script for binaries only
  const scriptPath = join(__dirname, '..', 'scripts', 'setup-binaries.sh');

  // Check if the binaries-only script exists, otherwise use original script with a message
  const originalScript = join(__dirname, '..', 'scripts', 'setup.sh');
  const targetScript = existsSync(scriptPath) ? scriptPath : originalScript;

  if (!existsSync(targetScript)) {
    console.error('Error: Setup script not found');
    process.exit(1);
  }

  console.log('Setting up native binaries...');
  console.log('This will configure: whisper-cli, llama-completion, sherpa-onnx');
  console.log('');

  const child = spawn('bash', [targetScript, '--binaries-only'], {
    stdio: 'inherit',
  });

  child.on('error', (err) => {
    if (err.message.includes('ENOENT')) {
      console.error('Error: bash not found. Please run the setup script manually:');
      console.error(`  bash ${targetScript}`);
    } else {
      console.error('Error running setup:', err.message);
    }
    process.exit(1);
  });

  return new Promise((resolve) => {
    child.on('close', (code) => {
      if (code !== 0) {
        process.exit(code ?? 1);
      }
      resolve();
    });
  });
}

// ============ Help ============

function printHelp(): void {
  console.log(`
mvas - Modular Voice Agent SDK CLI

Commands:
  setup <config.json>     Download models specified in config file
  setup --binaries-only   Set up native binaries (whisper-cli, llama-completion, sherpa-onnx)
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
        await setupBinaries();
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
