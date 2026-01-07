# Modular Voice Agent SDK Examples

Interactive examples demonstrating all the different configuration modes.

## Quick Start

```bash
npm install

# Pick an example to run (opens browser automatically):
npm run example1  # WebSpeech + Browser LLM (local, no server)
npm run example2  # Browser Whisper + Browser LLM (local, no server)
npm run example3  # Server Transformers.js (port 3100)
npm run example4  # Server Native (port 3101)
npm run example5  # WebSpeech + Server LLM (port 3104)
npm run example6  # Server STT+LLM + Browser TTS (port 3103)
npm run example7  # Native STT + Transformers.js LLM (port 3102)
npm run example8  # WebSpeech + Cloud LLM (port 3105)
npm run example9  # Native STT/TTS + Cloud LLM (port 3106)
```

> **Note:** Each server example loads ML models into memory. Run one at a time to avoid exhausting RAM.

## Available Examples

| # | Folder | Type | Description |
|---|--------|------|-------------|
| 1 | `example-1-speech-browser-speech` | Local | WebSpeech STT → Browser LLM → WebSpeech TTS |
| 2 | `example-2-browser-browser-speech` | Local | Browser Whisper → Browser LLM → WebSpeech TTS |
| 3 | `example-3-transformers-transformers-transformers` | Remote | All Transformers.js on server |
| 4 | `example-4-native-native-native` | Remote | All native binaries on server |
| 5 | `example-5-speech-native-speech` | Hybrid | WebSpeech STT → Native LLM → WebSpeech TTS |
| 6 | `example-6-transformers-transformers-speech` | Hybrid | Server Whisper → Server LLM → WebSpeech TTS |
| 7 | `example-7-native-transformers-speech` | Mixed | Native whisper.cpp → TF.js LLM → WebSpeech TTS |
| 8 | `example-8-speech-cloud-speech` | Hybrid | WebSpeech STT → Cloud LLM → WebSpeech TTS |
| 9 | `example-9-native-cloud-native` | Remote | whisper.cpp → Cloud LLM → sherpa-onnx |

## All Possible Configurations

Naming convention: `{stt}-{llm}-{tts}` where each component is:

| Option | STT | LLM | TTS |
|--------|-----|-----|-----|
| **native** | whisper.cpp (server) | llama.cpp (server) | sherpa-onnx (server) |
| **transformers** | Whisper Transformers.js (server) | TransformersLLM/Phi3 Transformers.js (server) | SpeechT5 Transformers.js (server) |
| **browser** | Whisper Transformers.js (browser) | TransformersLLM/Phi3 Transformers.js (browser) | ⚠️ No good model yet |
| **cloud** | ❌ N/A | OpenAI/Ollama/vLLM (server) | ❌ N/A |
| **speech** | WebSpeech API (browser) | ❌ N/A | WebSpeech API (browser) |

### Fully Local (4 combinations)

| Config | STT | LLM | TTS | Status |
|--------|-----|-----|-----|--------|
| `speech-browser-speech` | WebSpeech | Browser Transformers | WebSpeech | ✅ Example 1 |
| `browser-browser-speech` | Browser Whisper | Browser Transformers | WebSpeech | ✅ Example 2 |
| `speech-browser-browser` | WebSpeech | Browser Transformers | Browser TTS | ⚠️ No browser TTS model |
| `browser-browser-browser` | Browser Whisper | Browser Transformers | Browser TTS | ⚠️ No browser TTS model |

### Fully Remote (12 combinations)

| Config | STT | LLM | TTS | Status |
|--------|-----|-----|-----|--------|
| `native-native-native` | whisper.cpp | llama.cpp | sherpa-onnx | ✅ Example 4 |
| `native-cloud-native` | whisper.cpp | Cloud LLM | sherpa-onnx | ✅ Example 9 |
| `transformers-transformers-transformers` | Server Whisper | Server LLM | SpeechT5 | ✅ Example 3 |
| `transformers-cloud-transformers` | Server Whisper | Cloud LLM | SpeechT5 | ✅ Possible |
| `native-native-transformers` | whisper.cpp | llama.cpp | SpeechT5 | ✅ Possible |
| `native-cloud-transformers` | whisper.cpp | Cloud LLM | SpeechT5 | ✅ Possible |
| `native-transformers-native` | whisper.cpp | Server LLM | sherpa-onnx | ✅ Possible |
| `native-transformers-transformers` | whisper.cpp | Server LLM | SpeechT5 | ✅ Possible |
| `transformers-native-native` | Server Whisper | llama.cpp | sherpa-onnx | ✅ Possible |
| `transformers-cloud-native` | Server Whisper | Cloud LLM | sherpa-onnx | ✅ Possible |
| `transformers-native-transformers` | Server Whisper | llama.cpp | SpeechT5 | ✅ Possible |
| `transformers-transformers-native` | Server Whisper | Server LLM | sherpa-onnx | ✅ Possible |

### Hybrid: Local STT + Server LLM + Local TTS (12 combinations)

| Config | STT | LLM | TTS | Status |
|--------|-----|-----|-----|--------|
| `speech-native-speech` | WebSpeech | llama.cpp | WebSpeech | ✅ Example 5 |
| `speech-transformers-speech` | WebSpeech | Server LLM | WebSpeech | ✅ Possible |
| `speech-cloud-speech` | WebSpeech | Cloud LLM | WebSpeech | ✅ Example 8 |
| `browser-native-speech` | Browser Whisper | llama.cpp | WebSpeech | ✅ Possible |
| `browser-transformers-speech` | Browser Whisper | Server LLM | WebSpeech | ✅ Possible |
| `browser-cloud-speech` | Browser Whisper | Cloud LLM | WebSpeech | ✅ Possible |
| `speech-native-browser` | WebSpeech | llama.cpp | Browser TTS | ⚠️ No browser TTS model |
| `speech-transformers-browser` | WebSpeech | Server LLM | Browser TTS | ⚠️ No browser TTS model |
| `speech-cloud-browser` | WebSpeech | Cloud LLM | Browser TTS | ⚠️ No browser TTS model |
| `browser-native-browser` | Browser Whisper | llama.cpp | Browser TTS | ⚠️ No browser TTS model |
| `browser-transformers-browser` | Browser Whisper | Server LLM | Browser TTS | ⚠️ No browser TTS model |
| `browser-cloud-browser` | Browser Whisper | Cloud LLM | Browser TTS | ⚠️ No browser TTS model |

### Hybrid: Local STT + Server LLM + Server TTS (12 combinations)

| Config | STT | LLM | TTS | Status |
|--------|-----|-----|-----|--------|
| `speech-native-native` | WebSpeech | llama.cpp | sherpa-onnx | ✅ Possible |
| `speech-native-transformers` | WebSpeech | llama.cpp | SpeechT5 | ✅ Possible |
| `speech-cloud-native` | WebSpeech | Cloud LLM | sherpa-onnx | ✅ Possible |
| `speech-cloud-transformers` | WebSpeech | Cloud LLM | SpeechT5 | ✅ Possible |
| `speech-transformers-native` | WebSpeech | Server LLM | sherpa-onnx | ✅ Possible |
| `speech-transformers-transformers` | WebSpeech | Server LLM | SpeechT5 | ✅ Possible |
| `browser-native-native` | Browser Whisper | llama.cpp | sherpa-onnx | ✅ Possible |
| `browser-native-transformers` | Browser Whisper | llama.cpp | SpeechT5 | ✅ Possible |
| `browser-cloud-native` | Browser Whisper | Cloud LLM | sherpa-onnx | ✅ Possible |
| `browser-cloud-transformers` | Browser Whisper | Cloud LLM | SpeechT5 | ✅ Possible |
| `browser-transformers-native` | Browser Whisper | Server LLM | sherpa-onnx | ✅ Possible |
| `browser-transformers-transformers` | Browser Whisper | Server LLM | SpeechT5 | ✅ Possible |

### Hybrid: Server STT + Server LLM + Local TTS (12 combinations)

| Config | STT | LLM | TTS | Status |
|--------|-----|-----|-----|--------|
| `native-native-speech` | whisper.cpp | llama.cpp | WebSpeech | ✅ Possible |
| `native-cloud-speech` | whisper.cpp | Cloud LLM | WebSpeech | ✅ Possible |
| `native-transformers-speech` | whisper.cpp | Server LLM | WebSpeech | ✅ Example 7 |
| `transformers-native-speech` | Server Whisper | llama.cpp | WebSpeech | ✅ Possible |
| `transformers-cloud-speech` | Server Whisper | Cloud LLM | WebSpeech | ✅ Possible |
| `transformers-transformers-speech` | Server Whisper | Server LLM | WebSpeech | ✅ Example 6 |
| `native-native-browser` | whisper.cpp | llama.cpp | Browser TTS | ⚠️ No browser TTS model |
| `native-cloud-browser` | whisper.cpp | Cloud LLM | Browser TTS | ⚠️ No browser TTS model |
| `native-transformers-browser` | whisper.cpp | Server LLM | Browser TTS | ⚠️ No browser TTS model |
| `transformers-native-browser` | Server Whisper | llama.cpp | Browser TTS | ⚠️ No browser TTS model |
| `transformers-cloud-browser` | Server Whisper | Cloud LLM | Browser TTS | ⚠️ No browser TTS model |
| `transformers-transformers-browser` | Server Whisper | Server LLM | Browser TTS | ⚠️ No browser TTS model |

### Summary

- **52 total** configurations (with cloud LLM option)
- **38 currently possible** (✅)
- **14 waiting on browser TTS model** (⚠️)
- **9 examples** provided

## Server Ports

| Example | Port |
|---------|------|
| example3 (`transformers-transformers-transformers`) | 3100 |
| example4 (`native-native-native`) | 3101 |
| example7 (`native-transformers-speech`) | 3102 |
| example6 (`transformers-transformers-speech`) | 3103 |
| example5 (`speech-native-speech`) | 3104 |
| example8 (`speech-cloud-speech`) | 3105 |
| example9 (`native-cloud-native`) | 3106 |

## Prerequisites

### For Local Examples (no server needed)
- Modern browser with WebGPU support (Chrome 113+, Edge 113+)
- Microphone access

### For Native Server Examples
```bash
# macOS
brew install whisper-cpp llama.cpp

# Download models
npx mvas setup
```

### For Transformers.js Server Examples
No additional setup needed - models download automatically on first run.

### For Cloud LLM Examples
```bash
export OPENAI_API_KEY=sk-your-key-here
```

