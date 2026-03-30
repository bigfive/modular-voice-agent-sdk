/**
 * Client for Browser Agent Speech Example - Voice + Text Input
 *
 * - STT: Transformers.js Whisper (browser, works in Brave/Firefox too)
 * - LLM: Pi Agent on server (handles tools internally)
 * - TTS: WebSpeech API (browser native)
 *
 * Supports both voice (push-to-talk) and text input (Enter to send).
 * Text input skips TTS so user can read the response.
 */

import { VoiceClient, createVoiceClient, WebSpeechTTS } from 'modular-voice-agent-sdk/client';
import { TransformersSTT } from 'modular-voice-agent-sdk';
import {
  getUIElements,
  createMessageHelpers,
  createToolDisplayHelpers,
  setupAllControls,
  updateRecordButtonState,
  remoteStatusMap,
} from '../shared';

// ============ Browser Support Check ============

const support = VoiceClient.getBrowserSupport();

if (!support.webGPU) {
  document.body.innerHTML = `
    <div style="max-width: 600px; margin: 50px auto; padding: 20px; font-family: system-ui; text-align: center;">
      <h1>⚠️ WebGPU Not Available</h1>
      <p>This example requires WebGPU for Transformers.js STT.</p>
      <p style="color: #666;">
        WebGPU is supported in <strong>Chrome 113+</strong>, <strong>Edge 113+</strong>,
        <strong>Safari 17+</strong>, and <strong>Firefox 133+</strong>.
      </p>
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
    stt: new TransformersSTT({
      model: 'Xenova/whisper-tiny.en',
      dtype: 'q8',
    }, modelStore),
    llm: null,  // Server handles via Pi Agent
    tts: new WebSpeechTTS({ voiceName: 'Samantha', rate: 1.1 }),
    serverUrl: 'ws://localhost:3111',
  }),
});

// ============ UI Setup ============

const elements = getUIElements();
const messages = createMessageHelpers(elements.conversation);
const toolDisplay = createToolDisplayHelpers(elements.conversation);

let currentAssistantEl: HTMLElement | null = null;
let currentAssistantText = '';

// ============ Event Handlers ============

client.on('status', (status) => {
  const statusMap: Record<string, string> = {
    ...remoteStatusMap,
    ready: 'Ready (agent mode)',
    processing: 'Agent working...',
  };
  elements.status.textContent = statusMap[status] || status;
  updateRecordButtonState(elements.recordBtn, status, false);
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

// Tool call events - shows agent activity (read, write, edit, bash, etc.)
client.on('toolCall', (toolCall) => {
  if (currentAssistantEl) {
    toolDisplay.addToolCall(currentAssistantEl, toolCall.name, toolCall.arguments);
  }
});

client.on('toolResult', (_toolCallId, result) => {
  if (currentAssistantEl) {
    toolDisplay.addToolResult(currentAssistantEl, result);
  }
});

client.on('error', (err) => {
  console.error('Voice client error:', err);
  elements.status.textContent = 'Error: ' + err.message;
});

// ============ Controls ============

setupAllControls({ client, elements, messages });

// ============ Connect ============

console.log('Mode:', client.getMode());
console.log('Local components:', client.getLocalComponents());

await client.connect();
