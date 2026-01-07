/**
 * Shared demo tools for voice pipeline examples
 *
 * These are example tools that demonstrate function calling.
 * In a real application, you'd implement actual API calls.
 */

import type { Tool } from 'modular-voice-agent-sdk';

// ============ Time Tool ============

/**
 * Tool that returns the current date and time.
 */
export const getCurrentTimeTool: Tool = {
  name: 'get_current_time',
  description: 'Get the current date and time',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async () => {
    const now = new Date();
    return {
      time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      date: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    };
  },
};

// ============ Weather Tool ============

/**
 * Tool that returns mock weather data for a location.
 * In a real app, this would call a weather API.
 */
export const getWeatherTool: Tool = {
  name: 'get_weather',
  description: 'Get the current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'The city name, e.g., "San Francisco" or "London"',
      },
    },
    required: ['location'],
  },
  execute: async (args) => {
    const location = args.location as string;
    const conditions = ['sunny', 'partly cloudy', 'cloudy', 'rainy'];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temp = Math.floor(Math.random() * 30) + 50; // 50-80°F

    return {
      location,
      temperature: `${temp}°F`,
      condition,
      humidity: `${Math.floor(Math.random() * 40) + 40}%`,
    };
  },
};

// ============ Dice Tool ============

/**
 * Tool that rolls dice using standard notation (e.g., "2d6", "1d20").
 */
export const rollDiceTool: Tool = {
  name: 'roll_dice',
  description: 'Roll dice for games. Supports standard notation like "2d6" (two six-sided dice) or "1d20" (one twenty-sided die)',
  parameters: {
    type: 'object',
    properties: {
      notation: {
        type: 'string',
        description: 'Dice notation, e.g., "2d6", "1d20", "3d8"',
      },
    },
    required: ['notation'],
  },
  execute: async (args) => {
    const notation = (args.notation as string).toLowerCase();
    const match = notation.match(/^(\d+)d(\d+)$/);

    if (!match) {
      return { error: 'Invalid dice notation. Use format like "2d6" or "1d20"' };
    }

    const numDice = parseInt(match[1], 10);
    const numSides = parseInt(match[2], 10);

    if (numDice > 20 || numSides > 100) {
      return { error: 'Too many dice or sides' };
    }

    const rolls: number[] = [];
    for (let i = 0; i < numDice; i++) {
      rolls.push(Math.floor(Math.random() * numSides) + 1);
    }

    return {
      notation,
      rolls,
      total: rolls.reduce((a, b) => a + b, 0),
    };
  },
};

// ============ Preset Collections ============

/**
 * Standard demo tools for examples.
 * Includes time, weather, and dice.
 */
export const demoTools: Tool[] = [
  getCurrentTimeTool,
  getWeatherTool,
  rollDiceTool,
];

