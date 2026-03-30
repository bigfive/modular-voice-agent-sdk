/**
 * UI Components Demo
 */

import { createVoiceClient, WebSpeechTTS } from 'modular-voice-agent-sdk/client';
import { TransformersLLM } from 'modular-voice-agent-sdk';
import { ChatRenderer } from '../../src/ui';
import { TransformersSTT } from 'modular-voice-agent-sdk';

const client = createVoiceClient({
  create: (modelStore) => ({
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
    tts: new WebSpeechTTS({ voiceName: 'samantha', rate: 1.1 }),
    systemPrompt: 'You are a helpful voice assistant. Keep responses brief.',
  }),
});

const chatContainer = document.getElementById('chat-container')!;
const statusEl = document.getElementById('status')!;
const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn')!;
const textInput = document.getElementById('textInput') as HTMLInputElement;
const toolModal = document.getElementById('tool-modal')!;
const toolModalTitle = document.getElementById('tool-modal-title')!;
const toolModalBody = document.getElementById('tool-modal-body')!;
const toolModalClose = document.getElementById('tool-modal-close')!;

const renderer = new ChatRenderer({
  onToolDetail: (content) => {
    toolModalTitle.textContent = content.title;
    toolModalBody.innerHTML = content.body;
    toolModal.style.display = 'flex';
  },
});

chatContainer.appendChild(renderer.getContainer());
renderer.attachTo(chatContainer);

toolModal.addEventListener('click', (e) => {
  if (e.target === toolModal) toolModal.style.display = 'none';
});
toolModalClose.addEventListener('click', () => {
  toolModal.style.display = 'none';
});

const statusMap: Record<string, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  initializing: 'Loading model...',
  ready: 'Ready - hold to speak',
  listening: 'Listening...',
  processing: 'Thinking...',
  speaking: 'Speaking...',
};

client.on('status', (status) => {
  statusEl.textContent = statusMap[status] || status;
  recordBtn.disabled = status !== 'ready' && status !== 'speaking';
  recordBtn.classList.toggle('recording', status === 'listening');
  textInput.disabled = status !== 'ready' && status !== 'speaking';
});

const activeDownloads = new Map<string, number>();

client.on('progress', (info) => {
  if (info.status === 'progress' && info.file && info.progress !== undefined) {
    activeDownloads.set(info.file, info.progress);
    const maxProgress = Math.max(...activeDownloads.values());
    statusEl.textContent = `Loading: ${Math.round(maxProgress)}%`;
  } else if (info.status === 'done' && info.file) {
    activeDownloads.delete(info.file);
    if (activeDownloads.size === 0) {
      statusEl.textContent = 'Initializing...';
    }
  }
});

client.on('transcript', (text) => {
  renderer.appendUserMessage(text);
  renderer.startAssistantMessage();
});

let currentAssistantText = '';

client.on('responseChunk', (chunk) => {
  currentAssistantText += chunk;
  renderer.updateAssistantContent([{ type: 'text', text: currentAssistantText }]);
});

client.on('responseComplete', () => {
  currentAssistantText = '';
  renderer.finalizeAssistantMessage();
});

client.on('error', (err) => {
  console.error('Voice client error:', err);
  statusEl.textContent = 'Error: ' + err.message;
});

recordBtn.addEventListener('mousedown', () => client.startRecording());
recordBtn.addEventListener('mouseup', () => client.stopRecording());
recordBtn.addEventListener('mouseleave', () => {
  if (client.getStatus() === 'listening') client.stopRecording();
});
recordBtn.addEventListener('touchstart', (e) => { e.preventDefault(); client.startRecording(); });
recordBtn.addEventListener('touchend', (e) => { e.preventDefault(); client.stopRecording(); });

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body && !e.repeat) {
    e.preventDefault();
    client.startRecording();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    if (client.getStatus() === 'listening') client.stopRecording();
  }
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.repeat) {
    const text = textInput.value.trim();
    if (!text) return;
    textInput.value = '';
    client.sendText(text);
  }
});

clearBtn.addEventListener('click', () => {
  renderer.clear();
  client.clearHistory();
});

await client.connect();
