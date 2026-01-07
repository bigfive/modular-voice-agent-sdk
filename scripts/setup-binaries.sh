#!/bin/bash
#
# Setup native binaries for modular-voice-agent-sdk
# Binaries are stored in ~/.cache/mvas/bin/
#
# Usage: npx mvas setup --binaries-only
#

set -e

# Use global cache directory
CACHE_DIR="${MVAS_CACHE:-$HOME/.cache/mvas}"
BIN_DIR="$CACHE_DIR/bin"

echo "Modular Voice Agent SDK - Binary Setup"
echo "======================================="
echo "Binary directory: $BIN_DIR"
echo ""

mkdir -p "$BIN_DIR"

cd "$BIN_DIR"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

# --- whisper.cpp ---
echo "==> Setting up whisper-cli..."
if [ -L "whisper-cli" ] || [ -f "whisper-cli" ]; then
  echo "    Already exists, skipping."
else
  # Try to find whisper-cli from Homebrew or PATH
  if command -v whisper-cli &> /dev/null; then
    WHISPER_PATH="$(command -v whisper-cli)"
    ln -s "$WHISPER_PATH" whisper-cli
    echo "    Linked to $WHISPER_PATH"
  elif [ -f "/opt/homebrew/bin/whisper-cli" ]; then
    ln -s /opt/homebrew/bin/whisper-cli whisper-cli
    echo "    Linked to /opt/homebrew/bin/whisper-cli"
  elif [ -f "/usr/local/bin/whisper-cli" ]; then
    ln -s /usr/local/bin/whisper-cli whisper-cli
    echo "    Linked to /usr/local/bin/whisper-cli"
  else
    echo "    ⚠️  whisper-cli not found. Install with: brew install whisper-cpp"
  fi
fi

# --- llama.cpp (llama-completion) ---
echo ""
echo "==> Setting up llama-completion..."
if [ -L "llama-completion" ] || [ -f "llama-completion" ]; then
  echo "    Already exists, skipping."
else
  # Try to find llama-completion from PATH or common locations
  if command -v llama-completion &> /dev/null; then
    LLAMA_PATH="$(command -v llama-completion)"
    ln -s "$LLAMA_PATH" llama-completion
    echo "    Linked to $LLAMA_PATH"
  elif [ -f "/opt/homebrew/bin/llama-completion" ]; then
    ln -s /opt/homebrew/bin/llama-completion llama-completion
    echo "    Linked to /opt/homebrew/bin/llama-completion"
  elif [ -f "/usr/local/bin/llama-completion" ]; then
    ln -s /usr/local/bin/llama-completion llama-completion
    echo "    Linked to /usr/local/bin/llama-completion"
  else
    echo "    ⚠️  llama-completion not found."
    echo "       Install with: brew install llama.cpp"
    echo "       Or build from source: git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp && make"
  fi
fi

# --- sherpa-onnx (TTS) ---
echo ""
echo "==> Setting up sherpa-onnx for $OS/$ARCH..."

if [ -f "sherpa-onnx-offline-tts" ]; then
  echo "    Already exists, skipping."
else
  case "$OS" in
    Darwin)
      # macOS - universal binary (arm64 + x86_64)
      SHERPA_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-osx-universal2-shared.tar.bz2"
      SHERPA_DIR="sherpa-onnx-v1.12.20-osx-universal2-shared"
      ;;
    Linux)
      if [ "$ARCH" = "x86_64" ]; then
        SHERPA_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-linux-x64-shared.tar.bz2"
        SHERPA_DIR="sherpa-onnx-v1.12.20-linux-x64-shared"
      elif [ "$ARCH" = "aarch64" ]; then
        SHERPA_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-linux-aarch64-shared.tar.bz2"
        SHERPA_DIR="sherpa-onnx-v1.12.20-linux-aarch64-shared"
      else
        echo "    Unsupported Linux architecture: $ARCH"
        exit 1
      fi
      ;;
    *)
      echo "    Unsupported OS: $OS"
      echo "    Download manually from: https://github.com/k2-fsa/sherpa-onnx/releases"
      exit 1
      ;;
  esac

  echo "    Downloading from $SHERPA_URL..."
  curl -L --progress-bar -o sherpa-onnx.tar.bz2 "$SHERPA_URL"
  tar -xjf sherpa-onnx.tar.bz2

  # Only copy the TTS binary we need (not all the extras)
  cp "$SHERPA_DIR/bin/sherpa-onnx-offline-tts" .
  mkdir -p lib
  mv "$SHERPA_DIR/lib/"* lib/

  # Fix library paths on macOS so binary can find libs in ./lib/
  if [ "$OS" = "Darwin" ]; then
    echo "    Fixing library paths..."
    for lib in lib/*.dylib; do
      libname=$(basename "$lib")
      install_name_tool -change "@rpath/$libname" "@executable_path/lib/$libname" sherpa-onnx-offline-tts 2>/dev/null || true
    done
  fi

  # Cleanup
  rm -rf "$SHERPA_DIR" sherpa-onnx.tar.bz2

  echo "    Done!"
fi

# ============ Summary ============

echo ""
echo "============================================================"
echo "Binary setup complete!"
echo "============================================================"
echo ""
echo "Binaries location: $BIN_DIR"
echo ""
ls -lh "$BIN_DIR" 2>/dev/null || true

# Check for missing dependencies
MISSING_BREW=""
[ ! -L "$BIN_DIR/whisper-cli" ] && [ ! -f "$BIN_DIR/whisper-cli" ] && MISSING_BREW="$MISSING_BREW whisper-cpp"
[ ! -L "$BIN_DIR/llama-completion" ] && [ ! -f "$BIN_DIR/llama-completion" ] && MISSING_BREW="$MISSING_BREW llama.cpp"

if [ -n "$MISSING_BREW" ]; then
  echo ""
  echo "⚠️  Missing dependencies:"
  echo "  brew install$MISSING_BREW"
  echo ""
  echo "Then re-run: npx mvas setup --binaries-only"
else
  echo ""
  echo "✅ All binaries set up!"
fi

echo ""
echo "You can customize the cache location with:"
echo "  export MVAS_CACHE=/path/to/cache"

