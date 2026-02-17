/**
 * HTTP + SSE Transport
 *
 * Transport that uses HTTP POST for client→server messages and
 * Server-Sent Events (SSE) for server→client streaming.
 *
 * Useful for:
 * - Environments where WebSocket isn't available or is blocked
 * - Simpler server setups (standard HTTP endpoints)
 * - Serverless/edge deployments that don't support long-lived connections
 * - Debugging (HTTP requests are easier to inspect)
 *
 * Protocol:
 * - POST /session → creates a session, returns { sessionId }
 * - GET  /events?sessionId=xxx → SSE stream of ServerEnvelope events
 * - POST /message → sends a ClientEnvelope to the server
 *
 * Audio considerations:
 * - Works best for text-only or hybrid (client-side STT/TTS) modes
 * - Audio chunks are accumulated and sent as POST requests
 * - Higher latency than WebSocket for real-time audio streaming
 */

import type { ClientEnvelope, ServerEnvelope } from '../protocol';
import type { Transport, TransportState } from '../transport';

export interface HttpSseTransportConfig {
  /**
   * Base URL of the server (e.g., 'http://localhost:3000')
   */
  baseUrl: string;

  /**
   * Custom path for session creation (default: '/session')
   */
  sessionPath?: string;

  /**
   * Custom path for SSE events (default: '/events')
   */
  eventsPath?: string;

  /**
   * Custom path for sending messages (default: '/message')
   */
  messagePath?: string;

  /**
   * Custom headers to include in all requests (e.g., authorization)
   */
  headers?: Record<string, string>;
}

export class HttpSseTransport implements Transport {
  private state: TransportState = 'closed';
  private sessionId: string | null = null;
  private eventSource: EventSource | null = null;
  private messageHandler: ((envelope: ServerEnvelope) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  private readonly baseUrl: string;
  private readonly sessionPath: string;
  private readonly eventsPath: string;
  private readonly messagePath: string;
  private readonly headers: Record<string, string>;

  constructor(config: HttpSseTransportConfig | string) {
    if (typeof config === 'string') {
      config = { baseUrl: config };
    }
    // Strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.sessionPath = config.sessionPath ?? '/session';
    this.eventsPath = config.eventsPath ?? '/events';
    this.messagePath = config.messagePath ?? '/message';
    this.headers = config.headers ?? {};
  }

  get readyState(): TransportState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state === 'open') return;

    this.state = 'connecting';

    try {
      // Step 1: Create a session via POST
      const response = await fetch(`${this.baseUrl}${this.sessionPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`Session creation failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { sessionId: string };
      this.sessionId = data.sessionId;

      // Step 2: Open SSE stream for server→client messages
      await this.connectEventSource();

      this.state = 'open';
    } catch (error) {
      this.state = 'closed';
      throw error;
    }
  }

  private connectEventSource(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = `${this.baseUrl}${this.eventsPath}?sessionId=${encodeURIComponent(this.sessionId!)}`;
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        resolve();
      };

      this.eventSource.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data) as ServerEnvelope;
          this.messageHandler?.(envelope);
        } catch {
          this.errorHandler?.(new Error('Failed to parse SSE message'));
        }
      };

      this.eventSource.onerror = () => {
        if (this.state === 'connecting') {
          reject(new Error('SSE connection failed'));
        } else if (this.state === 'open') {
          this.state = 'closed';
          this.errorHandler?.(new Error('SSE connection lost'));
          this.closeHandler?.();
        }
      };
    });
  }

  send(envelope: ClientEnvelope): void {
    if (this.state !== 'open') return;

    fetch(`${this.baseUrl}${this.messagePath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(envelope),
    }).catch((error) => {
      this.errorHandler?.(error instanceof Error ? error : new Error(String(error)));
    });
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
    this.eventSource?.close();
    this.eventSource = null;
    this.sessionId = null;
    this.state = 'closed';
  }
}
