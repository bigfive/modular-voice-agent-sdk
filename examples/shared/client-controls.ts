/**
 * Shared control handlers for voice pipeline examples
 *
 * Sets up button and keyboard controls for recording.
 */

import type { VoiceClient } from 'modular-voice-agent-sdk/client';
import type { UIElements, MessageHelpers } from './client-ui';

// ============ Types ============

export interface ControlsConfig {
  /** The VoiceClient instance */
  client: VoiceClient;
  /** UI elements from getUIElements() */
  elements: UIElements;
  /** Message helpers from createMessageHelpers() */
  messages: MessageHelpers;
}

// ============ Setup Functions ============

/**
 * Set up push-to-talk controls on the record button.
 * Supports mouse, touch, and keyboard (spacebar).
 */
export function setupRecordButton(client: VoiceClient, recordBtn: HTMLButtonElement): void {
  // Mouse controls
  recordBtn.addEventListener('mousedown', () => client.startRecording());
  recordBtn.addEventListener('mouseup', () => client.stopRecording());
  recordBtn.addEventListener('mouseleave', () => {
    if (client.isRecording()) client.stopRecording();
  });

  // Touch controls
  recordBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    client.startRecording();
  });
  recordBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    client.stopRecording();
  });
}

/**
 * Set up spacebar push-to-talk.
 */
export function setupKeyboardControls(client: VoiceClient, recordBtn: HTMLButtonElement): void {
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && !recordBtn.disabled) {
      e.preventDefault();
      client.startRecording();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      client.stopRecording();
    }
  });
}

/**
 * Set up the clear button to clear conversation history.
 */
export function setupClearButton(
  client: VoiceClient,
  clearBtn: HTMLButtonElement,
  clearConversation: () => void,
): void {
  clearBtn.addEventListener('click', () => {
    client.clearHistory();
    clearConversation();
  });
}

/**
 * Set up all controls at once (record button, keyboard, clear button).
 */
export function setupAllControls(config: ControlsConfig): void {
  const { client, elements, messages } = config;

  setupRecordButton(client, elements.recordBtn);
  setupKeyboardControls(client, elements.recordBtn);
  setupClearButton(client, elements.clearBtn, messages.clearConversation);
}

// ============ Status UI Updates ============

/**
 * Update the record button appearance based on status.
 */
export function updateRecordButtonState(
  recordBtn: HTMLButtonElement,
  status: string,
  isLocalMode: boolean,
): void {
  // Disable during connecting/processing states
  if (isLocalMode) {
    recordBtn.disabled = !['ready', 'speaking'].includes(status);
  } else {
    recordBtn.disabled = ['disconnected', 'connecting', 'processing'].includes(status);
  }

  // Update visual state
  if (status === 'listening') {
    recordBtn.textContent = '⏹️ Stop';
    recordBtn.classList.add('recording');
  } else {
    recordBtn.textContent = '🎤 Hold to Speak';
    recordBtn.classList.remove('recording');
  }
}

