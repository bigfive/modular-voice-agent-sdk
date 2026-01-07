/**
 * CloudAudioLLM Example - Multimodal Audio with OpenAI gpt-audio-mini
 *
 * Demonstrates multimodal audio processing:
 * - Audio Recording: Browser MediaRecorder (sends raw audio to server)
 * - STT + LLM: CloudAudioLLM on server (single API call - gpt-audio-mini)
 * - TTS: WebSpeech API (browser native - speaks response)
 *
 * The server uses CloudAudioLLM which processes audio directly with the LLM,
 * getting both transcription and response in a single API call.
 *
 * Demonstrates tool/function calling - try asking:
 * - "What time is it?"
 * - "What's the weather in Paris?"
 * - "Roll 2d6 for me"
 */

import {
  createVoiceClient,
  WebSpeechTTS,
} from 'modular-voice-agent-sdk/client';
import {
  getUIElements,
  createMessageHelpers,
  createToolDisplayHelpers,
  setupAllControls,
  updateRecordButtonState,
  remoteStatusMap,
} from '../shared';

// ============ Config ============

const client = createVoiceClient({
  create: (/* modelStore */) => ({
    // No local STT - server handles audio directly with multimodal LLM
    stt: null,
    // Server LLM - CloudAudioLLM processes audio directly
    llm: null,
    // Local TTS - speaks response text from server
    tts: new WebSpeechTTS({ voiceName: 'Samantha', rate: 1.1 }),
    serverUrl: 'ws://localhost:3107',
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
    ready: 'Ready (multimodal audio)',
    processing: 'Processing audio...',
  };
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

// Tool call events - show when the assistant uses tools
client.on('toolCall', (toolCall) => {
  if (currentAssistantEl) {
    toolDisplay.addToolCall(
      currentAssistantEl,
      toolCall.name,
      toolCall.arguments
    );
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

console.log('Mode:', client.getMode()); // 'remote'
console.log('Local components:', client.getLocalComponents()); // { stt: false, llm: false, tts: true }

client.connect();

