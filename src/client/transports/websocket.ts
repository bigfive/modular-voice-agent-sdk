/**
 * WebSocket Transport
 *
 * Standard WebSocket-based transport for voice pipeline communication.
 * This is the default transport used by VoiceClient when a serverUrl is provided.
 *
 * Features:
 * - Full-duplex communication
 * - Real-time audio streaming
 * - Low latency
 */

import type { ClientEnvelope, ServerEnvelope } from '../protocol';
import type { Transport, TransportState } from '../transport';

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private messageHandler: ((envelope: ServerEnvelope) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(private url: string) {}

  get readyState(): TransportState {
    if (!this.ws) return 'closed';
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN: return 'open';
      default: return 'closed';
    }
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        resolve();
      };

      this.ws.onclose = () => {
        this.closeHandler?.();
      };

      this.ws.onerror = () => {
        const error = new Error('WebSocket error');
        this.errorHandler?.(error);
        // Reject only if we haven't connected yet
        if (this.ws?.readyState !== WebSocket.OPEN) {
          reject(error);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data) as ServerEnvelope;
          this.messageHandler?.(envelope);
        } catch {
          this.errorHandler?.(new Error('Failed to parse server message'));
        }
      };
    });
  }

  send(envelope: ClientEnvelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    }
  }

  onMessage(handler: (envelope: ServerEnvelope) => void): void {
    this.messageHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
