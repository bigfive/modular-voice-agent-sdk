/**
 * Modular Voice Agent SDK - Browser Client
 *
 * High-level SDK for building voice assistant browser clients.
 *
 * @example
 * ```typescript
 * import { VoiceClient } from 'modular-voice-agent-sdk/client';
 *
 * const client = new VoiceClient({ serverUrl: 'ws://localhost:8080' });
 *
 * client.on('transcript', (text) => console.log('User:', text));
 * client.on('responseChunk', (chunk) => console.log('Assistant:', chunk));
 * client.on('status', (status) => console.log('Status:', status));
 *
 * client.connect();
 *
 * // Push-to-talk
 * button.onmousedown = () => client.startRecording();
 * button.onmouseup = () => client.stopRecording();
 * ```
 */

// Main SDK
export { VoiceClient, createVoiceClient } from './voice-client';
export type {
  VoiceClientConfig,
  VoiceClientEvents,
  VoiceClientStatus,
  BrowserSupport,
  ClientComponents,
  ClientComponentFactory,
  EventMeta,
  ToolCallInfo,
} from './voice-client';

// Re-export ModelStore for convenience (also available from main module)
export type { ModelStore } from '../voice-pipeline';

// Browser speech APIs (for local STT/TTS)
export { WebSpeechSTT } from './web-speech-stt';
export type { WebSpeechSTTConfig, WebSpeechSTTResult } from './web-speech-stt';

export { WebSpeechTTS } from './web-speech-tts';
export type { WebSpeechTTSConfig } from './web-speech-tts';

// Lower-level utilities (for custom implementations)
export { AudioRecorder } from './audio-recorder';
export type { AudioRecorderConfig, AudioChunkCallback } from './audio-recorder';

export { AudioPlayer } from './audio-player';
export type { AudioPlayerConfig } from './audio-player';

// Protocol types and utilities
export {
  float32ToBase64,
  base64ToFloat32,
  generateId,
  type IdPrefix,
  type ClientEnvelope,
  type ServerEnvelope,
  type ClientMessage,
  type ServerMessage,
  type SessionInitMessage,
  type AudioMessage,
  type EndAudioMessage,
  type ClearHistoryMessage,
  type TextMessage,
  type TranscriptMessage,
  type ResponseChunkMessage,
  type AudioResponseMessage,
  type CompleteMessage,
  type ErrorMessage,
} from './protocol';

