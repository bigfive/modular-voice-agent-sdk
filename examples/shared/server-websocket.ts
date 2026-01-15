/**
 * Shared WebSocket server setup for voice pipeline examples
 *
 * Provides a simple wrapper to reduce boilerplate while keeping
 * the session handling visible in each example.
 *
 * All messages use the envelope protocol with session/request/response IDs.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { PipelineHandler, PipelineSession } from 'modular-voice-agent-sdk/server';
import type { ClientEnvelope, ServerEnvelope, ServerMessage } from 'modular-voice-agent-sdk/client';
import { generateId } from 'modular-voice-agent-sdk/client';

// ============ Types ============

export interface WebSocketServerConfig {
  /** Port to listen on */
  port: number;
  /** Pipeline handler from createPipelineHandler() */
  handler: PipelineHandler;
  /** Optional callback when a client connects */
  onConnect?: (ws: WebSocket, session: PipelineSession) => void;
  /** Optional callback when a client disconnects */
  onDisconnect?: (ws: WebSocket) => void;
  /** Optional callback for errors */
  onError?: (ws: WebSocket, error: Error) => void;
}

// ============ Helper Functions ============

/**
 * Send a server message wrapped in an envelope
 */
function sendEnvelope(
  ws: WebSocket,
  sessionId: string,
  requestId: string | null,
  message: ServerMessage
): void {
  const envelope: ServerEnvelope = {
    sessionId,
    requestId,
    responseId: generateId('res'),
    message,
  };
  ws.send(JSON.stringify(envelope));
}

// ============ Server Setup ============

/**
 * Start a WebSocket server that handles voice pipeline messages.
 *
 * This is a thin wrapper that:
 * - Creates a WebSocketServer
 * - Creates sessions for each connection (with unique session IDs)
 * - Sends session_init on connect
 * - Unwraps incoming ClientEnvelope messages
 * - Wraps outgoing messages in ServerEnvelope
 * - Routes messages through session.handle()
 * - Cleans up sessions on disconnect
 */
export function startWebSocketServer(config: WebSocketServerConfig): WebSocketServer {
  const { port, handler, onConnect, onDisconnect, onError } = config;

  const wss = new WebSocketServer({ port });

  wss.on('connection', async (ws) => {
    console.log('Client connected');
    const session = await handler.createSession();
    const sessionId = session.getSessionId();

    console.log(`Session created: ${sessionId}`);

    // Notify callback
    onConnect?.(ws, session);

    // Send session_init message to client
    sendEnvelope(ws, sessionId, null, {
      type: 'session_init',
      sessionId,
    });

    ws.on('message', async (data) => {
      try {
        const envelope = JSON.parse(data.toString()) as ClientEnvelope;
        const { requestId, message } = envelope;

        // Track current request for this session
        session.setCurrentRequestId(requestId);

        // Log capabilities when received (useful for debugging)
        if (message.type === 'capabilities') {
          const caps = session.getCapabilities();
          console.log(`Client capabilities: STT=${caps.hasSTT}, TTS=${caps.hasTTS}`);
        }

        // Route message through session handler
        for await (const response of session.handle(message)) {
          sendEnvelope(ws, sessionId, requestId, response);
        }
      } catch (err) {
        console.error('Message error:', err);
        onError?.(ws, err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.on('close', () => {
      console.log(`Client disconnected: ${sessionId}`);
      session.destroy();
      onDisconnect?.(ws);
    });
  });

  return wss;
}

// ============ Logging Helpers ============

/**
 * Log pipeline initialization info.
 */
export function logPipelineInfo(handler: PipelineHandler, extras?: Record<string, string>): void {
  const info = handler.getPipelineInfo();
  console.log(`Pipeline capabilities: STT=${info.hasSTT}, TTS=${info.hasTTS}`);
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      console.log(`  ${key}: ${value}`);
    }
  }
}

