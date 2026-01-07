# Usage Guide

Detailed documentation for modular-voice-agent-sdk. For a quick overview, see [README.md](../README.md).

## Two Ways to Use

**Option 1: Browser Only**

Create a `VoiceClient` with all components running locally in the browser. No server needed.

```typescript
import { createVoiceClient, WebSpeechSTT, WebSpeechTTS } from 'modular-voice-agent-sdk/client';
import { TransformersLLM } from 'modular-voice-agent-sdk';

const client = createVoiceClient({
  stt: new WebSpeechSTT(),
  llm: new TransformersLLM({ model: '...' }),
  tts: new WebSpeechTTS(),
  systemPrompt: '...',
});
```

**Option 2: Browser + Server**

Create a `VoiceClient` in the browser and a `VoicePipeline` on the server. Connect them via WebSocket. Set any component to `null` on the client to have the server handle it.

```typescript
// Browser
const client = createVoiceClient({
  stt: null,  // server handles
  llm: null,  // server handles
  tts: null,  // server handles
  serverUrl: 'ws://localhost:3100',
});

// Server - backends use factory functions for per-session isolation
const pipeline = new VoicePipeline({
  stt: () => new NativeSTT({ model: 'base.en' }),
  llm: () => new CloudLLM({ model: 'gpt-4o', ... }),
  tts: () => new NativeTTS({ model: 'en_US-amy-medium' }),
  systemPrompt: '...',
});
```

You can mix and match — run STT and TTS in the browser while the server handles just the LLM, or any other combination.

---

## Table of Contents

- [VoiceClient (Browser)](#voiceclient-browser)
- [VoicePipeline (Server)](#voicepipeline-server)
- [Configuration Examples](#configuration-examples)
- [Tools (Function Calling)](#tools-function-calling)
- [Backend Reference](#backend-reference)
- [Exports](#exports)

## VoiceClient (Browser)

The unified browser SDK for voice interactions.

### Creating a Client

```typescript
const client = createVoiceClient({
  // STT options: browser speech API, browser/server JS, or server handles
  stt: WebSpeechSTT | TransformersSTT | null,

  // LLM options: browser/server JS, or server handles
  llm: TransformersLLM | null,

  // TTS options: browser speech API, browser/server JS, or server handles
  tts: WebSpeechTTS | TransformersTTS | null,

  // Required if any component is null
  serverUrl: 'ws://localhost:3100',

  // Required if llm is provided locally
  systemPrompt: 'You are a helpful assistant.',

  // Optional
  sampleRate: 16000,
  autoReconnect: true,
  reconnectDelay: 2000,
});
```

### Events

```typescript
client.on('status', (status) => {
  // 'disconnected' | 'connecting' | 'initializing' | 'ready' | 'listening' | 'processing' | 'speaking'
});

client.on('transcript', (text) => {
  // User's transcribed speech
});

client.on('responseChunk', (chunk) => {
  // Streaming LLM token
});

client.on('responseComplete', (fullText) => {
  // Complete LLM response
});

client.on('progress', ({ status, file, progress }) => {
  // Model loading progress (for Transformers.js backends)
});

client.on('error', (err) => {
  // Error object
});
```

### Methods

```typescript
await client.connect();          // Initialize local components + connect to server
await client.startRecording();   // Start listening
await client.stopRecording();    // Stop and process
client.clearHistory();           // Reset conversation
client.getMode();                // 'local' | 'remote' | 'hybrid'
client.getLocalComponents();     // { stt: boolean, llm: boolean, tts: boolean }
client.isReady();
client.isRecording();
client.disconnect();
await client.dispose();
```

## VoicePipeline (Server)

The server-side pipeline that processes audio/text through STT → LLM → TTS.

### Creating a Pipeline

Backends are passed as factory functions, allowing the pipeline to create isolated instances per session:

```typescript
const pipeline = new VoicePipeline({
  // STT factory: JS or native binary, or null if client handles
  stt: () => new TransformersSTT(...) | () => new NativeSTT(...) | null,

  // LLM factory: JS, native binary, or cloud API (required)
  llm: () => new TransformersLLM(...) | () => new NativeLLM(...) | () => new CloudLLM(...),

  // TTS factory: JS or native binary, or null if client handles
  tts: () => new TransformersTTS(...) | () => new NativeTTS(...) | null,

  systemPrompt: string,
  tools?: Tool[],             // optional function calling
});

await pipeline.initialize();  // Warms model cache for fast session startup
```

### Processing

```typescript
// Process audio (requires STT)
await pipeline.processAudio(audioFloat32Array, {
  onTranscript: (text) => {},
  onResponseChunk: (chunk) => {},
  onAudio: (playable) => {},
  onComplete: () => {},
  onError: (err) => {},
});

// Process text (for when client does STT)
await pipeline.processText('Hello', callbacks);
```

### Utility Methods

```typescript
pipeline.hasSTT();       // boolean
pipeline.hasTTS();       // boolean
pipeline.clearHistory(); // Reset conversation context
```

### WebSocket Handler

For integrating with any WebSocket server:

```typescript
import { WebSocketServer } from 'ws';
import { createPipelineHandler } from 'modular-voice-agent-sdk/server';

const handler = createPipelineHandler(pipeline);
const wss = new WebSocketServer({ port: 3100 });

wss.on('connection', (ws) => {
  const session = handler.createSession();
  ws.on('message', async (data) => {
    for await (const msg of session.handle(JSON.parse(data.toString()))) {
      ws.send(JSON.stringify(msg));
    }
  });
  ws.on('close', () => session.destroy());
});
```

## Configuration Examples

### Fully Local (No Server)

Everything runs in the browser:

```typescript
import { createVoiceClient, WebSpeechSTT, WebSpeechTTS } from 'modular-voice-agent-sdk/client';
import { TransformersLLM } from 'modular-voice-agent-sdk';

const client = createVoiceClient({
  stt: new WebSpeechSTT({ language: 'en-US' }),
  llm: new TransformersLLM({
    model: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    dtype: 'q4',
    maxNewTokens: 140,
    device: 'webgpu',
  }),
  tts: new WebSpeechTTS({ voiceName: 'Samantha' }),
  systemPrompt: 'You are a helpful voice assistant.',
});
```

### Fully Remote (Server)

Client sends audio, server handles everything:

**Client:**
```typescript
const client = createVoiceClient({
  stt: null,
  llm: null,
  tts: null,
  serverUrl: 'ws://localhost:3100',
});
```

**Server:**
```typescript
const pipeline = new VoicePipeline({
  stt: () => new TransformersSTT({ model: 'Xenova/whisper-small', dtype: 'q8' }),
  llm: () => new TransformersLLM({ model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct', dtype: 'q4' }),
  tts: () => new TransformersTTS({ model: 'Xenova/speecht5_tts', dtype: 'fp16', speakerEmbeddings: '...' }),
  systemPrompt: 'You are a helpful voice assistant.',
});
```

### Hybrid (Browser STT/TTS + Server LLM)

**Client:**
```typescript
const client = createVoiceClient({
  stt: new WebSpeechSTT({ language: 'en-US' }),
  llm: null,
  tts: new WebSpeechTTS({ voiceName: 'Samantha' }),
  serverUrl: 'ws://localhost:3100',
});
```

**Server:**
```typescript
const pipeline = new VoicePipeline({
  stt: null,
  llm: () => new NativeLLM({ model: 'llama-3.2-1b-instruct-q4_k_m.gguf' }),
  tts: null,
  systemPrompt: 'You are a helpful voice assistant.',
});
```

### Cloud LLM

**Server:**
```typescript
import { CloudLLM } from 'modular-voice-agent-sdk/cloud';

const pipeline = new VoicePipeline({
  stt: () => new NativeSTT({ model: 'base.en' }),
  llm: () => new CloudLLM({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o',
    maxTokens: 256,
  }),
  tts: () => new NativeTTS({ model: 'en_US-amy-medium' }),
  systemPrompt: 'You are a helpful voice assistant.',
});
```

Works with **OpenAI**, **Ollama** (`http://localhost:11434/v1`), **vLLM**, **LMStudio**, and any OpenAI-compatible endpoint.

## Tools (Function Calling)

Give your voice assistant the ability to take actions — check the weather, control smart home devices, query databases, or call any API.

### Defining a Tool

```typescript
import { Tool } from 'modular-voice-agent-sdk';

const getWeather: Tool = {
  name: 'get_weather',
  description: 'Get the current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name, e.g., "San Francisco"',
      },
    },
    required: ['location'],
  },
  execute: async (args) => {
    const location = args.location as string;
    // Call your weather API here
    return { location, temperature: '72°F', condition: 'sunny' };
  },
};
```

### Using Tools

```typescript
const pipeline = new VoicePipeline({
  llm: () => new CloudLLM({ ... }),
  systemPrompt: 'You are a helpful assistant.',
  tools: [getWeather, getTime, rollDice],
});
```

### Tool Events

```typescript
await pipeline.processText('What\'s the weather in Tokyo?', {
  onToolCall: (call) => console.log(`Calling ${call.name}...`),
  onToolResult: (id, result) => console.log('Result:', result),
  onResponseChunk: (chunk) => console.log(chunk),
});
```

### Backend Support

All LLM backends support tools with the same API:

| Backend | How Tools Work |
|---------|----------------|
| `CloudLLM` | Native OpenAI function calling API |
| `NativeLLM` | GBNF grammar constraint — guarantees valid JSON tool calls |
| `TransformersLLM` | Prompt injection (instructions added to system prompt) |

You don't need to do anything different — just pass `tools` and the backend handles it.

### Complete Example

```typescript
import { VoicePipeline, Tool } from 'modular-voice-agent-sdk';
import { CloudLLM } from 'modular-voice-agent-sdk/cloud';

const tools: Tool[] = [
  {
    name: 'get_current_time',
    description: 'Get the current date and time',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({
      time: new Date().toLocaleTimeString(),
      date: new Date().toLocaleDateString(),
    }),
  },
  {
    name: 'roll_dice',
    description: 'Roll dice, e.g., "2d6" for two six-sided dice',
    parameters: {
      type: 'object',
      properties: {
        notation: { type: 'string', description: 'Dice notation like "2d6"' },
      },
      required: ['notation'],
    },
    execute: async (args) => {
      const [num, sides] = (args.notation as string).split('d').map(Number);
      const rolls = Array.from({ length: num }, () => Math.floor(Math.random() * sides) + 1);
      return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
    },
  },
];

const pipeline = new VoicePipeline({
  llm: () => new CloudLLM({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o',
  }),
  systemPrompt: 'You are a helpful assistant. Use tools when needed.',
  tools,
});
```

See `examples/example-5` and `examples/example-8` for full working examples with tools.

## Backend Reference

### WebSpeechSTT

Browser Speech Recognition API. Zero setup, works in Chrome/Edge/Safari.

```typescript
new WebSpeechSTT({
  language: 'en-US',        // BCP-47 language code
  continuous: false,        // Keep listening after speech ends
  interimResults: false,    // Emit partial results
})
```

### WebSpeechTTS

Browser Speech Synthesis API. Zero setup, uses system voices.

```typescript
new WebSpeechTTS({
  voiceName: 'Samantha',    // System voice name (optional)
  lang: 'en-US',            // Language code
  rate: 1.0,                // Speech rate (0.1 - 10)
  pitch: 1.0,               // Pitch (0 - 2)
})
```

### TransformersSTT

Whisper models via Transformers.js. Runs in browser (WebGPU) or Node.js.

```typescript
new TransformersSTT({
  model: 'Xenova/whisper-small',
  dtype: 'q8',              // 'fp32' | 'fp16' | 'q8' | 'q4'
  device: 'webgpu',         // 'webgpu' | 'cpu' (browser) or 'cpu' (node)
})
```

### TransformersLLM

Any Hugging Face text-generation model via Transformers.js.

```typescript
new TransformersLLM({
  model: 'HuggingFaceTB/SmolLM2-360M-Instruct',
  dtype: 'q4',
  device: 'webgpu',
  maxNewTokens: 140,
})
```

### TransformersTTS

SpeechT5 via Transformers.js.

```typescript
new TransformersTTS({
  model: 'Xenova/speecht5_tts',
  dtype: 'fp16',
  speakerEmbeddings: '...',  // URL or path to speaker embeddings
})
```

### NativeSTT

whisper.cpp binary. Server-only, fast.

```typescript
new NativeSTT({
  model: 'base.en',         // Whisper model name
  modelPath: '...',         // Optional: custom path to .bin file
})
```

### NativeLLM

llama.cpp binary. Server-only, fast.

```typescript
new NativeLLM({
  model: 'llama-3.2-1b-instruct-q4_k_m.gguf',
  modelPath: '...',         // Optional: custom path
  contextSize: 2048,
  temperature: 0.7,
})
```

### NativeTTS

sherpa-onnx binary. Server-only.

```typescript
new NativeTTS({
  model: 'en_US-amy-medium',
  modelPath: '...',         // Optional: custom path
})
```

### CloudLLM

Any OpenAI-compatible API.

```typescript
new CloudLLM({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
  maxTokens: 256,
  temperature: 0.7,
})
```

**Compatible services:**
- OpenAI (`https://api.openai.com/v1`)
- Ollama (`http://localhost:11434/v1`)
- vLLM (`http://localhost:8000/v1`)
- LMStudio (`http://localhost:1234/v1`)
- Any OpenAI-compatible endpoint

### CloudAudioLLM

Multimodal audio LLM that handles both STT and LLM in a single API call. Implements both `STTPipeline` and `LLMPipeline` interfaces.

```typescript
new CloudAudioLLM({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-audio-preview',
  sampleRate: 16000,          // Audio sample rate
  maxTokens: 256,
})
```

Use by passing the same factory to both `stt` and `llm`:

```typescript
const audioLLM = () => new CloudAudioLLM({ ... });
const pipeline = new VoicePipeline({
  stt: audioLLM,
  llm: audioLLM,  // Same factory - pipeline detects and shares the instance
  tts: null,
  systemPrompt: '...',
});
```

## Capability Detection

The server supports automatic capability detection for scenarios where you need one server to handle multiple client types (e.g., during rolling deployments).

```typescript
const pipeline = new VoicePipeline({
  stt: () => new NativeSTT({ ... }),  // used if client sends audio
  llm: () => new NativeLLM({ ... }),
  tts: () => new NativeTTS({ ... }),  // skipped if client has local TTS
  systemPrompt: '...',
});
```

When a client connects, it announces its capabilities. The server then:
- Skips STT if client sends text instead of audio
- Skips TTS if client handles speech synthesis locally

This is useful for zero-downtime upgrades where old and new clients coexist, but for most cases you should just configure the server with exactly what it needs (using `null` for components the client handles).

## Exports

```typescript
// Main library - pipeline + Transformers.js backends
import { VoicePipeline, TransformersSTT, TransformersLLM, TransformersTTS } from 'modular-voice-agent-sdk';

// Client SDK - unified browser interface
import {
  createVoiceClient,
  VoiceClient,
  WebSpeechSTT,
  WebSpeechTTS
} from 'modular-voice-agent-sdk/client';

// Server utilities - WebSocket handler
import { createPipelineHandler } from 'modular-voice-agent-sdk/server';

// Native backends (server-only)
import {
  NativeSTT,
  NativeLLM,
  NativeTTS,
  defaultPaths,
  getCacheDir
} from 'modular-voice-agent-sdk/native';

// Cloud backends (server-only)
import { CloudLLM, CloudAudioLLM } from 'modular-voice-agent-sdk/cloud';
```
