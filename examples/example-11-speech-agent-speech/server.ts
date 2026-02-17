/**
 * Server Example - Pi Agent (Voice-Controlled Coding Agent)
 *
 * Hybrid mode: Client handles STT and TTS, server runs a Pi Agent
 * - STT: Client (WebSpeech) - server receives text
 * - LLM: Pi Agent (with coding tools: read, write, edit, bash)
 * - TTS: Client (WebSpeech) - server sends text only
 *
 * The Pi Agent handles tool execution internally — the voice pipeline
 * only receives text responses and tool activity notifications.
 *
 * Environment:
 *   OPENCODE_API_KEY - API key for the model provider (default: 'public')
 *
 * Run: npm run example11
 */

import { Agent } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';
import { codingTools } from '@mariozechner/pi-coding-agent';
import { createVoicePipeline } from 'modular-voice-agent-sdk';
import { AgentLLM, PiAgentProvider } from 'modular-voice-agent-sdk/agent';
import { createPipelineHandler } from 'modular-voice-agent-sdk/server';
import { startWebSocketServer, logPipelineInfo } from '../shared';

const PORT = 3108;

// Pi Agent with coding tools (read, bash, edit, write)
const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a helpful voice-controlled coding assistant. Keep responses brief and conversational — you are speaking out loud. When you perform actions like reading or editing files, briefly describe what you did.',
    model: getModel('opencode', 'big-pickle'),
    thinkingLevel: 'off',
    tools: codingTools,
  },
  getApiKey: async () => process.env.OPENCODE_API_KEY ?? 'public',
});

// ============ Agent Event Logging ============
// You own the agent instance, so you can subscribe to ALL events directly.
// This runs independently of the voice pipeline — useful for logging,
// debugging, or building a richer server-side UI.
agent.subscribe((event) => {
  switch (event.type) {
    case 'agent_start':
      console.log('\n--- Agent started ---');
      break;

    case 'turn_start':
      console.log('  [turn] New turn');
      break;

    case 'message_start':
      console.log(`  [msg]  ${event.message.role} message started`);
      break;

    case 'message_update': {
      const ae = event.assistantMessageEvent;
      if (ae?.type === 'text_delta') {
        process.stdout.write(ae.delta ?? '');
      } else if (ae?.type === 'thinking_delta') {
        process.stdout.write(`\x1b[2m${ae.delta ?? ''}\x1b[0m`); // dim text for thinking
      }
      break;
    }

    case 'message_end':
      if (event.message.role === 'assistant') {
        console.log(''); // newline after streamed text
      }
      break;

    case 'tool_execution_start':
      console.log(`  [tool] ${event.toolName}(${JSON.stringify(event.args)})`);
      break;

    case 'tool_execution_end': {
      const preview = JSON.stringify(event.result)?.slice(0, 200);
      const status = event.isError ? 'ERROR' : 'ok';
      console.log(`  [tool] ${event.toolName} → ${status}: ${preview}`);
      break;
    }

    case 'turn_end':
      console.log('  [turn] Turn complete');
      break;

    case 'agent_end':
      console.log('--- Agent finished ---\n');
      break;
  }
});

async function main(): Promise<void> {
  const toolNames = codingTools.map(t => t.name).join(', ');
  console.log('Initializing Pi Agent voice pipeline...');
  console.log(`  Provider: opencode`);
  console.log(`  Model:    big-pickle`);
  console.log(`  Tools:    ${toolNames}`);
  console.log(`  STT:      Client handles (WebSpeech)`);
  console.log(`  TTS:      Client handles (WebSpeech)`);

  const pipeline = createVoicePipeline({
    create: () => ({
      stt: null,   // Client does WebSpeech STT
      llm: new AgentLLM(new PiAgentProvider({ agent })),
      tts: null,   // Client does WebSpeech TTS
      systemPrompt: '', // System prompt is managed by the Pi Agent
    }),
  });

  await pipeline.initialize();
  console.log('Pi Agent voice pipeline ready.');

  const handler = createPipelineHandler(pipeline);
  logPipelineInfo(handler);

  startWebSocketServer({ port: PORT, handler });

  console.log(`Server running on ws://localhost:${PORT}`);
  console.log('');
  console.log('The agent handles tool calls internally.');
  console.log('You\'ll see tool activity in the UI as the agent works.');
}

main().catch(console.error);
