/**
 * Local Transformers.js Example
 *
 * Everything runs in the browser - no server needed!
 * - STT: Whisper (Transformers.js via WebGPU)
 * - LLM: TransformersLLM (Transformers.js via WebGPU)
 * - TTS: WebSpeech API (browser native)
 *
 * Higher quality STT than WebSpeech, but requires model download.
 * Works in all browsers with WebGPU support (Chrome, Edge, Safari, Brave, Firefox 133+).
 */

import { VoiceClient, createVoiceClient, WebSpeechTTS } from 'modular-voice-agent-sdk/client';
import { TransformersSTT, TransformersLLM } from 'modular-voice-agent-sdk';
import {
  getUIElements,
  createMessageHelpers,
  setupAllControls,
  updateRecordButtonState,
  localStatusMap,
} from '../shared';

// ============ Browser Support Check ============

const support = VoiceClient.getBrowserSupport();

if (!support.webGPU) {
  document.body.innerHTML = `
    <div style="max-width: 600px; margin: 50px auto; padding: 20px; font-family: system-ui; text-align: center;">
      <h1>⚠️ WebGPU Not Available</h1>
      <p>This example requires WebGPU for ML model inference.</p>
      <p style="color: #666;">
        WebGPU is supported in <strong>Chrome 113+</strong>, <strong>Edge 113+</strong>,
        <strong>Safari 17+</strong>, and <strong>Firefox 133+</strong>.
      </p>
      <div style="margin-top: 20px; padding: 15px; background: #f0f9ff; border-radius: 8px;">
        <p><strong>Try one of these alternatives:</strong></p>
        <ul style="text-align: left; display: inline-block;">
          <li><a href="../transformers-transformers-transformers/">transformers-transformers-transformers</a> - Server-side processing</li>
          <li><a href="../native-native-native/">native-native-native</a> - Native server backends</li>
        </ul>
      </div>
    </div>
  `;
  throw new Error('WebGPU not supported');
}

if (!support.webSpeechTTS) {
  console.warn('WebSpeech TTS not available - audio output will be disabled');
}

// ============ Config ============

const client = createVoiceClient({
  create: (modelStore) => ({
    // All components are local - no server needed!
    stt: new TransformersSTT({
      model: 'Xenova/whisper-tiny.en',
      dtype: 'q8',
    }, modelStore),
    llm: new TransformersLLM({
      model: 'HuggingFaceTB/SmolLM2-360M-Instruct',
      dtype: 'q4',
      maxNewTokens: 140,
      temperature: 0.7,
      device: 'webgpu',
    }, modelStore),
    tts: new WebSpeechTTS({ voiceName: 'Samantha', rate: 1.1 }),
    systemPrompt: 'You are a helpful voice assistant. Keep responses brief—1-2 sentences. Speak naturally.',
    // Note: no serverUrl needed!
  }),
});

// ============ UI Setup ============

const elements = getUIElements();
const messages = createMessageHelpers(elements.conversation);

let currentAssistantEl: HTMLElement | null = null;
let currentAssistantText = '';

// ============ Event Handlers ============

client.on('status', (status) => {
  elements.status.textContent = localStatusMap[status] || status;
  updateRecordButtonState(elements.recordBtn, status, true);
});

client.on('progress', ({ status: progressStatus, file, progress }) => {
  if (progressStatus === 'progress' && progress) {
    elements.status.textContent = `Loading: ${file?.split('/').pop() || 'model'} ${Math.round(progress)}%`;
  }
});

client.on('transcript', (text) => {
  messages.addMessage('user', text);
  currentAssistantEl = messages.addMessage('assistant', '...');
  currentAssistantText = '';
});

client.on('responseChunk', (chunk) => {
  currentAssistantText += chunk;
  if (currentAssistantEl) {
    messages.updateMessage(currentAssistantEl, currentAssistantText);
  }
});

client.on('responseComplete', () => {
  currentAssistantEl = null;
});

client.on('error', (err) => {
  console.error('Voice client error:', err);
  elements.status.textContent = 'Error: ' + err.message;
});

// ============ Controls ============

setupAllControls({ client, elements, messages });

// ============ Initialize ============

console.log('Mode:', client.getMode());
console.log('Local components:', client.getLocalComponents());

await client.connect(); // No server connection - just initializes local components
