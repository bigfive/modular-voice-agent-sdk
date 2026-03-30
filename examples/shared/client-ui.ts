/**
 * Shared UI helpers for voice pipeline examples
 *
 * These helpers reduce boilerplate while keeping the framework's
 * event handling visible in each example.
 */

// ============ Types ============

export interface UIElements {
  status: HTMLElement;
  conversation: HTMLElement;
  recordBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  /** Optional text input for typed messages (may be null if not present in DOM) */
  textInput: HTMLInputElement | null;
}

export interface MessageHelpers {
  /** Add a message to the conversation */
  addMessage: (role: 'user' | 'assistant', text: string) => HTMLElement;
  /** Update the text content of a message element */
  updateMessage: (el: HTMLElement, text: string) => void;
  /** Clear the conversation with a system message */
  clearConversation: (message?: string) => void;
}

export interface ToolDisplayHelpers {
  /** Add a tool call display to an element */
  addToolCall: (el: HTMLElement, toolName: string, args: Record<string, unknown>) => void;
  /** Add a tool result display to an element */
  addToolResult: (el: HTMLElement, result: unknown) => void;
}

// ============ UI Element Selection ============

/**
 * Get standard UI elements from the DOM.
 * All examples use the same element IDs.
 */
export function getUIElements(): UIElements {
  return {
    status: document.getElementById('status')!,
    conversation: document.getElementById('conversation')!,
    recordBtn: document.getElementById('recordBtn') as HTMLButtonElement,
    clearBtn: document.getElementById('clearBtn') as HTMLButtonElement,
    textInput: document.getElementById('textInput') as HTMLInputElement | null,
  };
}

// ============ Message Helpers ============

/**
 * Create message helper functions bound to a conversation element.
 */
export function createMessageHelpers(conversation: HTMLElement): MessageHelpers {
  return {
    addMessage(role: 'user' | 'assistant', text: string): HTMLElement {
      const div = document.createElement('div');
      div.className = `message ${role}`;
      div.innerHTML = `<strong>${role === 'user' ? 'You' : 'Assistant'}:</strong> <span class="text">${text}</span>`;
      conversation.appendChild(div);
      conversation.scrollTop = conversation.scrollHeight;
      return div;
    },

    updateMessage(el: HTMLElement, text: string): void {
      const span = el.querySelector('.text') || el.querySelector('span');
      if (span) span.textContent = text;
      conversation.scrollTop = conversation.scrollHeight;
    },

    clearConversation(message = 'Conversation cleared.'): void {
      conversation.innerHTML = `<div class="message system">${message}</div>`;
    },
  };
}

// ============ Tool Display Helpers ============

/**
 * Create tool display helpers for examples with function calling.
 * Tools are displayed inline within assistant messages.
 */
export function createToolDisplayHelpers(conversation: HTMLElement): ToolDisplayHelpers {
  function getOrCreateToolDetails(el: HTMLElement): HTMLElement {
    let details = el.querySelector('.tool-details') as HTMLElement;
    if (!details) {
      details = document.createElement('div');
      details.className = 'tool-details';
      el.appendChild(details);
    }
    return details;
  }

  return {
    addToolCall(el: HTMLElement, toolName: string, args: Record<string, unknown>): void {
      const details = getOrCreateToolDetails(el);
      const toolDiv = document.createElement('div');
      toolDiv.className = 'tool-item';
      toolDiv.innerHTML = `<span class="tool-icon">🔧</span> <span class="tool-label">Using:</span> <span class="tool-name">${toolName}</span>`;
      if (Object.keys(args).length > 0) {
        toolDiv.innerHTML += `<code class="tool-args">${JSON.stringify(args)}</code>`;
      }
      details.appendChild(toolDiv);
      conversation.scrollTop = conversation.scrollHeight;
    },

    addToolResult(el: HTMLElement, result: unknown): void {
      const details = getOrCreateToolDetails(el);
      const resultDiv = document.createElement('div');
      resultDiv.className = 'tool-item tool-result';
      resultDiv.innerHTML = `<span class="tool-icon">✓</span> <span class="tool-label">Result:</span> <code class="tool-result-code">${JSON.stringify(result)}</code>`;
      details.appendChild(resultDiv);
      conversation.scrollTop = conversation.scrollHeight;
    },
  };
}

// ============ Status Map Helpers ============

/** Default status messages for remote/server mode */
export const remoteStatusMap: Record<string, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  ready: 'Ready',
  listening: 'Listening...',
  processing: 'Processing...',
  speaking: 'Speaking...',
};

/** Default status messages for local/browser mode */
export const localStatusMap: Record<string, string> = {
  disconnected: 'Not initialized',
  initializing: 'Loading models...',
  ready: 'Ready (fully local)',
  listening: 'Listening...',
  processing: 'Thinking...',
  speaking: 'Speaking...',
};

