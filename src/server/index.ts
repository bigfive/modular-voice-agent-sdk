/**
 * Modular Voice Agent SDK - Server Utilities
 *
 * Framework-agnostic handlers for building voice assistant servers.
 * Works with any WebSocket library (ws, Socket.io, Bun, Deno, etc.)
 *
 * @example
 * ```typescript
 * import { VoicePipeline } from 'modular-voice-agent-sdk';
 * import { createPipelineHandler } from 'modular-voice-agent-sdk/server';
 * import { WebSocketServer } from 'ws';
 *
 * const pipeline = new VoicePipeline({ stt, llm, tts, systemPrompt });
 * const handler = createPipelineHandler(pipeline);
 *
 * wss.on('connection', (ws) => {
 *   const session = handler.createSession();
 *   ws.on('message', async (data) => {
 *     for await (const msg of session.handle(JSON.parse(data))) {
 *       ws.send(JSON.stringify(msg));
 *     }
 *   });
 *   ws.on('close', () => session.destroy());
 * });
 * ```
 */

export { createPipelineHandler, PipelineHandler, PipelineSession } from './handler';
export type { PipelineHandlerConfig } from './handler';

// Re-export protocol types for server use
export {
  float32ToBase64,
  base64ToFloat32,
  type ClientMessage,
  type ServerMessage,
  type AudioMessage,
  type EndAudioMessage,
  type ClearHistoryMessage,
  type TranscriptMessage,
  type ResponseChunkMessage,
  type AudioResponseMessage,
  type CompleteMessage,
  type ErrorMessage,
} from '../client/protocol';

// Server-side encoding utilities (use Buffer for efficiency in Node.js)
export { float32ToBase64Node, base64ToFloat32Node } from './encoding';

