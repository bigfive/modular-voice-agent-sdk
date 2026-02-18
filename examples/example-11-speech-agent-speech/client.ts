/**
 * Client for Pi Agent Example - Voice-Controlled Coding Agent
 *
 * - STT: WebSpeech API (browser native)
 * - LLM: Pi Agent on server (handles tools internally)
 * - TTS: WebSpeech API (browser native)
 *
 * Tool calls from the agent are displayed in the UI as they happen,
 * but the agent handles execution — no tool results come back to the pipeline.
 */

import { VoiceClient, createVoiceClient, WebSpeechSTT, WebSpeechTTS } from 'modular-voice-agent-sdk/client';
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

if (!support.webSpeechSTTUsable) {
  document.body.innerHTML = `
    <div style="max-width: 600px; margin: 50px auto; padding: 20px; font-family: system-ui; text-align: center;">
      <h1>Browser Not Supported</h1>
      <p>WebSpeech STT is not available in this browser.</p>
      <p style="color: #666;">Use Chrome, Edge, or Safari.</p>
    </div>
  `;
  throw new Error('WebSpeech STT not supported');
}

// ============ Config ============

const client = createVoiceClient({
  create: () => ({
    stt: new WebSpeechSTT({ language: 'en-US' }),
    llm: null,  // Server handles via Pi Agent
    tts: new WebSpeechTTS({ voiceName: 'Samantha', rate: 1.1 }),
    serverUrl: 'ws://localhost:3108',
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
