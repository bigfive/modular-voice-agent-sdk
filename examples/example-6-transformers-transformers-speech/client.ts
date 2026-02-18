/**
 * Hybrid Example - Server STT+LLM with Browser TTS
 *
 * Server handles STT and LLM, browser handles TTS:
 * - STT: Whisper Transformers.js (server)
 * - LLM: TransformersLLM Transformers.js (server)
 * - TTS: WebSpeech API (browser)
 *
 * Good when you want:
 * - High-quality server-side transcription (better than WebSpeech)
 * - Natural browser voices
 * - Lower bandwidth (no audio sent back from server)
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
  create: (/* modelStore */) => ({
    // Server handles STT - client sends audio
    stt: null,
    // Server handles LLM
    llm: null,
    // Local TTS - speaks response text from server
    tts: new WebSpeechTTS({ voiceName: 'Samantha', rate: 1.1 }),
    serverUrl: 'ws://localhost:3103',
  }),
});

// ============ UI Setup ============

const elements = getUIElements();
const messages = createMessageHelpers(elements.conversation);

let currentAssistantEl: HTMLElement | null = null;
let currentAssistantText = '';

// ============ Event Handlers ============

client.on('status', (status) => {
  const statusMap: Record<string, string> = { ...remoteStatusMap, ready: 'Ready (server STT+LLM, browser TTS)', processing: 'Server processing...' };
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

console.log('Mode:', client.getMode()); // 'hybrid'
console.log('Local components:', client.getLocalComponents()); // { stt: false, llm: false, tts: true }

await client.connect();
