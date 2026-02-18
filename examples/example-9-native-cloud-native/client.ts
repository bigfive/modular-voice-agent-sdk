/**
 * Browser Client for Native STT/TTS + Cloud LLM Example
 *
 * Fully remote mode - server handles everything:
 * - STT: whisper.cpp (server)
 * - LLM: Cloud API (OpenAI/Ollama via server)
 * - TTS: sherpa-onnx (server)
 *
 * Client only sends/receives audio.
 */

import { createVoiceClient } from 'modular-voice-agent-sdk/client';
import {
  getUIElements,
  createMessageHelpers,
  setupAllControls,
  updateRecordButtonState,
  remoteStatusMap,
} from '../shared';

// ============ Config ============

const client = createVoiceClient({
  create: (/* modelStore */) => ({
    // All null = server handles everything
    stt: null,
    llm: null,
    tts: null,
    serverUrl: 'ws://localhost:3106',
  }),
});

// ============ UI Setup ============

const elements = getUIElements();
const messages = createMessageHelpers(elements.conversation);

let currentAssistantEl: HTMLElement | null = null;
let currentAssistantText = '';

// ============ Event Handlers ============

client.on('status', (status) => {
  const statusMap: Record<string, string> = { ...remoteStatusMap, ready: 'Ready (native + cloud)' };
  elements.status.textContent = statusMap[status] || status;
  updateRecordButtonState(elements.recordBtn, status, false);
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

// ============ Connect ============

console.log('Mode:', client.getMode());
console.log('Local components:', client.getLocalComponents());

await client.connect();
