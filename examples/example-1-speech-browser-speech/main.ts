/**
 * Fully Local Browser Example
 *
 * Everything runs in the browser - no server needed!
 * - STT: WebSpeech API (browser native)
 * - LLM: Transformers.js (TransformersLLM via WebGPU)
 * - TTS: WebSpeech API (browser native)
 *
 * This is the simplest setup - no models to download for STT/TTS.
 *
 * NOTE: WebSpeech STT only works in Chrome, Edge, and Safari.
 * For Brave/Firefox, use the browser-browser-speech example instead.
 */

import { VoiceClient, createVoiceClient, WebSpeechSTT, WebSpeechTTS } from 'modular-voice-agent-sdk/client';
import { TransformersLLM } from 'modular-voice-agent-sdk';
import {
  getUIElements,
  createMessageHelpers,
  setupAllControls,
  updateRecordButtonState,
  localStatusMap,
} from '../shared';

// ============ Browser Support Check ============

const support = VoiceClient.getBrowserSupport();

if (!support.webSpeechSTTUsable) {
  const isBraveMessage = support.isBrave
    ? `<p>You're using <strong>Brave</strong>, which blocks WebSpeech STT for privacy reasons
       (it requires connecting to Google's servers).</p>`
    : `<p style="color: #666;">
        This example uses the Web Speech API for voice recognition, which is only supported in
        <strong>Chrome</strong>, <strong>Edge</strong>, and <strong>Safari</strong>.
      </p>`;

  document.body.innerHTML = `
    <div style="max-width: 600px; margin: 50px auto; padding: 20px; font-family: system-ui; text-align: center;">
      <h1>⚠️ Browser Not Supported</h1>
      <p>WebSpeech STT is not available in this browser.</p>
      ${isBraveMessage}
      <div style="margin-top: 20px; padding: 15px; background: #f0f9ff; border-radius: 8px;">
        <p><strong>Try one of these alternatives:</strong></p>
        <ul style="text-align: left; display: inline-block;">
          <li><a href="../example-2-browser-browser-speech/">browser-browser-speech</a> - Uses Whisper (works in all browsers including Brave)</li>
          <li><a href="../example-3-transformers-transformers-transformers/">transformers-transformers-transformers</a> - Server-side processing</li>
        </ul>
      </div>
    </div>
  `;
  throw new Error('WebSpeech STT not supported');
}

// ============ Config ============

const client = createVoiceClient({
  create: (modelStore) => ({
    // All components are local - no server needed!
    stt: new WebSpeechSTT({ language: 'en-US' }),
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
  const statusMap: Record<string, string> = { ...localStatusMap, initializing: 'Loading LLM model...' };
  elements.status.textContent = statusMap[status] || status;
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
