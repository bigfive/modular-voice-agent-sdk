/**
 * Shared utilities for voice pipeline examples
 *
 * Import from '../shared' in example files.
 */

// Client-side helpers
export {
  getUIElements,
  createMessageHelpers,
  createToolDisplayHelpers,
  remoteStatusMap,
  localStatusMap,
  type UIElements,
  type MessageHelpers,
  type ToolDisplayHelpers,
} from './client-ui';

export {
  setupRecordButton,
  setupKeyboardControls,
  setupClearButton,
  setupTextInput,
  setupAllControls,
  updateRecordButtonState,
  type ControlsConfig,
} from './client-controls';

// Server-side helpers
export {
  startWebSocketServer,
  logPipelineInfo,
  type WebSocketServerConfig,
} from './server-websocket';

// Demo tools
export {
  getCurrentTimeTool,
  getWeatherTool,
  rollDiceTool,
  demoTools,
} from './tools';

