/**
 * Transport Interface
 *
 * Abstraction over the communication layer between client and server.
 * Implementations handle the details of connecting, sending envelopes,
 * and receiving envelopes over a specific transport mechanism.
 *
 * Built-in implementations:
 * - WebSocketTransport - Standard WebSocket (default)
 * - HttpSseTransport - HTTP POST + Server-Sent Events
 *
 * Custom transports can be created for postMessage, WebRTC, etc.
 */

import type { ClientEnvelope, ServerEnvelope } from './protocol';

// ============ Transport Interface ============

export type TransportState = 'connecting' | 'open' | 'closed';

/**
 * Transport interface for client-server communication.
 *
 * Transports handle the low-level details of:
 * - Establishing a connection to the server
 * - Sending ClientEnvelopes to the server
 * - Receiving ServerEnvelopes from the server
 * - Connection lifecycle (connect, disconnect, reconnect)
 *
 * @example
 * ```typescript
 * // Use WebSocket transport (default)
 * const transport = new WebSocketTransport('ws://localhost:3000');
 *
 * // Use HTTP+SSE transport
 * const transport = new HttpSseTransport('http://localhost:3000');
 *
 * // Pass to VoiceClient
 * const client = createVoiceClient({
 *   create: () => ({
 *     stt: null, llm: null, tts: new WebSpeechTTS(),
 *     transport,
 *   }),
 * });
 * ```
 */
export interface Transport {
  /** Current connection state */
  readonly readyState: TransportState;

  /** Connect to the server */
  connect(): Promise<void>;

  /** Send a client envelope to the server */
  send(envelope: ClientEnvelope): void;

  /** Register handler for incoming server envelopes */
  onMessage(handler: (envelope: ServerEnvelope) => void): void;

  /** Register handler for errors */
  onError(handler: (error: Error) => void): void;

  /** Register handler for close/disconnect */
  onClose(handler: () => void): void;

  /** Disconnect and clean up */
  close(): void;
}
