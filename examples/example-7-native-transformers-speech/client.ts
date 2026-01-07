/**
 * Client for Mixed Server Example
 *
 * Server uses native whisper.cpp + Transformers.js LLM
 * Client handles TTS with WebSpeech
 *
 * - STT: Native whisper.cpp (server)
 * - LLM: Transformers.js TransformersLLM (server)
 * - TTS: WebSpeech API (browser)
 */

import { createVoiceClient, WebSpeechTTS } from 'modular-voice-agent-sdk/client';
import {
  getUIElements,
  createMessageHelpers,
  setupAllControls,
  updateRecordButtonState,
  remoteStatusMap,
} from '../shared';

// ============ Config ============

const client = createVoiceClient({
  create: () => ({
    // Server handles STT (native whisper.cpp)
    stt: null,
    // Server handles LLM (Transformers.js)
    llm: null,
    // Local TTS - browser WebSpeech
    tts: new WebSpeechTTS({ voiceName: 'Samantha', rate: 1.1 }),
    serverUrl: 'ws://localhost:3102', // Points to mixed server
  }),
});

// ============ UI Setup ============

const elements = getUIElements();
const messages = createMessageHelpers(elements.conversation);

let currentAssistantEl: HTMLElement | null = null;
let currentAssistantText = '';

// ============ Event Handlers ============

client.on('status', (status) => {
  const statusMap: Record<string, string> = { ...remoteStatusMap, ready: 'Ready (native STT + TF LLM + browser TTS)', processing: 'Server processing...' };
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

client.connect();
