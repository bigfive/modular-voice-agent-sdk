export type ToolDetailContent = { title: string; body: string };

export interface ChatRendererOptions {
  onToolDetail?: (content: ToolDetailContent) => void;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolCall'; id: string; name: string; arguments?: unknown }
  | { type: 'toolResult'; toolCallId: string; result?: unknown; isError?: boolean };

export interface MessageData {
  role: 'user' | 'assistant';
  content: ContentBlock[];
  timestamp?: Date;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments?: unknown;
  result?: unknown;
  isError?: boolean;
}

export interface VoiceClientStatus {
  status: 'disconnected' | 'connecting' | 'initializing' | 'ready' | 'listening' | 'processing' | 'speaking';
}

export interface ToolDetailModalContent {
  title: string;
  body: string;
}