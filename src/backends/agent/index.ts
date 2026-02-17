/**
 * Agent Backend - Agent SDK support
 * Wraps coding agent SDKs (OpenCode, Pi Agent, Pi Coding Agent, etc.) as LLM backends.
 *
 * The agent handles tool execution internally — the voice pipeline
 * only receives text responses and tool activity notifications.
 */

// Core
export { AgentLLM } from './llm';
export type { AgentProvider, AgentSession, AgentStreamEvent } from './provider';

// Providers
export { OpenCodeAgentProvider } from './opencode-provider';
export type { OpenCodeAgentProviderConfig, OpenCodeClient } from './opencode-provider';

export { PiAgentProvider } from './pi-agent-provider';
export type { PiAgentProviderConfig, PiAgent } from './pi-agent-provider';

export { PiCodingAgentProvider } from './pi-coding-agent-provider';
export type { PiCodingAgentProviderConfig, PiCodingAgentSession } from './pi-coding-agent-provider';
