/**
 * Browser Client for Server-Transformers Example
 *
 * Fully remote mode - server handles everything:
 * - STT: Whisper (server)
 * - LLM: TransformersLLM (server)
 * - TTS: SpeechT5 (server)
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
  // All null = server handles everything
  stt: null,
  llm: null,
  tts: null,
  serverUrl: 'ws://localhost:3100',
});

// ============ UI Setup ============

const elements = getUIElements();
const messages = createMessageHelpers(elements.conversation);

let currentAssistantEl: HTMLElement | null = null;
let currentAssistantText = '';

// ============ Event Handlers ============

client.on('status', (status) => {
  elements.status.textContent = remoteStatusMap[status] || status;
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

client.connect();
