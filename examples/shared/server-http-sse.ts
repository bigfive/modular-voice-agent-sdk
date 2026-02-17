/**
 * Shared HTTP+SSE server setup for voice pipeline examples
 *
 * Alternative to server-websocket.ts that uses HTTP POST for client→server
 * messages and Server-Sent Events (SSE) for server→client streaming.
 *
 * Uses Node.js built-in `http` module - no additional dependencies required.
 *
 * Protocol:
 * - POST /session → creates a session, returns { sessionId }
 * - GET  /events?sessionId=xxx → SSE stream of ServerEnvelope events
 * - POST /message → sends a ClientEnvelope, server streams responses via SSE
 *
 * All messages use the envelope protocol with session/request/response IDs,
 * identical to the WebSocket adapter.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { PipelineHandler, PipelineSession } from 'modular-voice-agent-sdk/server';
import type { ClientEnvelope, ServerEnvelope, ServerMessage } from 'modular-voice-agent-sdk/client';
import { generateId } from 'modular-voice-agent-sdk/client';

// ============ Types ============

export interface HttpSseServerConfig {
  /** Port to listen on */
  port: number;
  /** Pipeline handler from createPipelineHandler() */
  handler: PipelineHandler;
  /** Optional callback when a session is created */
  onSessionCreate?: (sessionId: string, session: PipelineSession) => void;
  /** Optional callback when a session is closed */
  onSessionClose?: (sessionId: string) => void;
  /** Optional callback for errors */
  onError?: (sessionId: string | null, error: Error) => void;
  /** Allowed origins for CORS (default: '*') */
  allowedOrigins?: string | string[];
}

// ============ Session State ============

interface SessionState {
  session: PipelineSession;
  /** SSE response object for streaming back to client */
  sseResponse: ServerResponse | null;
  /** Response ID management */
  currentResponseId: string | null;
}

// ============ Helper Functions ============

function setCorsHeaders(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendSseEvent(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendEnvelope(
  sseResponse: ServerResponse,
  sessionId: string,
  requestId: string | null,
  responseId: string,
  message: ServerMessage
): void {
  const envelope: ServerEnvelope = {
    sessionId,
    requestId,
    responseId,
    message,
  };
  sendSseEvent(sseResponse, envelope);
}

// ============ Server Setup ============

/**
 * Start an HTTP+SSE server that handles voice pipeline messages.
 *
 * This is the HTTP equivalent of startWebSocketServer():
 * - POST /session creates a new pipeline session
 * - GET /events?sessionId=xxx opens an SSE stream for responses
 * - POST /message accepts ClientEnvelope and streams responses via SSE
 *
 * @example
 * ```typescript
 * const pipeline = createVoicePipeline({ ... });
 * const handler = createPipelineHandler(pipeline);
 * startHttpSseServer({ port: 3108, handler });
 * ```
 */
export function startHttpSseServer(config: HttpSseServerConfig) {
  const { port, handler, onSessionCreate, onSessionClose, onError } = config;
  const allowedOrigins = config.allowedOrigins ?? '*';

  // Session store keyed by sessionId
  const sessions = new Map<string, SessionState>();

  function getOrigin(_req: IncomingMessage): string {
    if (allowedOrigins === '*') return '*';
    // Could check req origin header against allowedOrigins array
    return typeof allowedOrigins === 'string' ? allowedOrigins : allowedOrigins[0] ?? '*';
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const origin = getOrigin(req);
    setCorsHeaders(res, origin);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // POST /session - Create a new session
      if (req.method === 'POST' && url.pathname === '/session') {
        const session = await handler.createSession();
        const sessionId = session.getSessionId();

        sessions.set(sessionId, {
          session,
          sseResponse: null,
          currentResponseId: null,
        });

        console.log(`Session created: ${sessionId}`);
        onSessionCreate?.(sessionId, session);
        sendJson(res, 200, { sessionId });
        return;
      }

      // GET /events?sessionId=xxx - SSE stream
      if (req.method === 'GET' && url.pathname === '/events') {
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId) {
          sendJson(res, 400, { error: 'sessionId query parameter required' });
          return;
        }

        const state = sessions.get(sessionId);
        if (!state) {
          sendJson(res, 404, { error: 'Session not found' });
          return;
        }

        // Set up SSE headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': origin,
        });

        // Store the SSE response for this session
        state.sseResponse = res;

        // Send session_init immediately
        sendEnvelope(res, sessionId, null, generateId('res'), {
          type: 'session_init',
          sessionId,
        });

        // Clean up on disconnect
        req.on('close', () => {
          console.log(`SSE disconnected: ${sessionId}`);
          state.sseResponse = null;
          state.session.destroy();
          sessions.delete(sessionId);
          onSessionClose?.(sessionId);
        });

        return;
      }

      // POST /message - Send a client message
      if (req.method === 'POST' && url.pathname === '/message') {
        const body = await parseBody(req);
        const envelope = JSON.parse(body) as ClientEnvelope;
        const { sessionId, requestId, message } = envelope;

        const state = sessions.get(sessionId);
        if (!state) {
          sendJson(res, 404, { error: 'Session not found' });
          return;
        }

        if (!state.sseResponse) {
          sendJson(res, 400, { error: 'SSE stream not connected. Open GET /events first.' });
          return;
        }

        // Track current request
        state.session.setCurrentRequestId(requestId);

        // Log capabilities when received
        if (message.type === 'capabilities') {
          const caps = state.session.getCapabilities();
          console.log(`Client capabilities: STT=${caps.hasSTT}, TTS=${caps.hasTTS}`);
        }

        // Process message and stream responses via SSE
        const nextResponseId = (): string => {
          state.currentResponseId = generateId('res');
          return state.currentResponseId;
        };

        const getStreamingResponseId = (): string => {
          if (!state.currentResponseId) {
            return nextResponseId();
          }
          return state.currentResponseId;
        };

        const resetStreamingResponseId = (): void => {
          state.currentResponseId = null;
        };

        for await (const response of state.session.handle(message)) {
          if (!state.sseResponse) break; // Client disconnected

          let responseId: string;
          switch (response.type) {
            case 'response_chunk':
            case 'audio':
            case 'complete':
              responseId = getStreamingResponseId();
              break;
            case 'transcript':
              responseId = nextResponseId();
              break;
            case 'tool_call':
            case 'tool_result':
            case 'error':
            case 'session_init':
            default:
              responseId = nextResponseId();
              break;
          }

          sendEnvelope(state.sseResponse, sessionId, requestId, responseId, response);

          if (response.type === 'complete' || response.type === 'error') {
            resetStreamingResponseId();
          }
        }

        // Acknowledge the message was processed
        sendJson(res, 200, { ok: true });
        return;
      }

      // Unknown route
      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('Request error:', err);
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(null, error);
      sendJson(res, 500, { error: error.message });
    }
  });

  server.listen(port, () => {
    console.log(`HTTP+SSE server listening on http://localhost:${port}`);
    console.log(`  POST /session  - Create session`);
    console.log(`  GET  /events   - SSE stream`);
    console.log(`  POST /message  - Send message`);
  });

  return server;
}
