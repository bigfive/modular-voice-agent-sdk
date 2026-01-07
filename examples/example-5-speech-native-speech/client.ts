/**
 * Hybrid Example - WebSpeech STT/TTS with Server LLM + Tools
 *
 * Best of both worlds:
 * - STT: WebSpeech API (browser native - instant, no download)
 * - LLM: Native llama.cpp (server) with tool calling
 * - TTS: WebSpeech API (browser native - natural voices)
 *
 * Demonstrates tool/function calling with native LLM - try asking:
 * - "What time is it?"
 * - "What's the weather in Paris?"
 * - "Roll 2d6 for me"
 *
 * NOTE: WebSpeech STT only works in Chrome, Edge, and Safari.
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

if (!support.webSpeechSTT) {
  document.body.innerHTML = `
    <div style="max-width: 600px; margin: 50px auto; padding: 20px; font-family: system-ui; text-align: center;">
      <h1>⚠️ Browser Not Supported</h1>
      <p>WebSpeech STT is not available in this browser.</p>
      <p style="color: #666;">
        This example uses the Web Speech API for voice recognition, which is only supported in
        <strong>Chrome</strong>, <strong>Edge</strong>, and <strong>Safari</strong>.
      </p>
      <div style="margin-top: 20px; padding: 15px; background: #f0f9ff; border-radius: 8px;">
        <p><strong>Try one of these alternatives:</strong></p>
        <ul style="text-align: left; display: inline-block;">
          <li><a href="../native-native-native/">native-native-native</a> - Server handles everything</li>
          <li><a href="../transformers-transformers-speech/">transformers-transformers-speech</a> - Server STT/LLM, local TTS</li>
        </ul>
      </div>
    </div>
  `;
  throw new Error('WebSpeech STT not supported');
}

// ============ Config ============

const client = createVoiceClient({
  // Local STT - transcribed text sent to server
  stt: new WebSpeechSTT({ language: 'en-US' }),
  // Server LLM - just processes text
  llm: null,
  // Local TTS - speaks response text from server
  tts: new WebSpeechTTS({ voiceName: 'Samantha', rate: 1.1 }),
  serverUrl: 'ws://localhost:3104',
});

// ============ UI Setup ============

const elements = getUIElements();
const messages = createMessageHelpers(elements.conversation);
const toolDisplay = createToolDisplayHelpers(elements.conversation);

let currentAssistantEl: HTMLElement | null = null;
let currentAssistantText = '';

// ============ Event Handlers ============

client.on('status', (status) => {
  const statusMap: Record<string, string> = { ...remoteStatusMap, ready: 'Ready (hybrid mode)', processing: 'Server thinking...' };
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

// Tool call events - show as grouped details within the assistant message
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

console.log('Mode:', client.getMode()); // 'hybrid'
console.log('Local components:', client.getLocalComponents()); // { stt: true, llm: false, tts: true }

client.connect();
