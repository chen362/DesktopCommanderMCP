#!/usr/bin/env node

import { ComputerUseService } from '../dist/computer-use/service.js';
import { buildComputerUseToolDefinitions } from '../dist/computer-use/tools.js';
import { computerUseToolArgSchemas } from '../dist/computer-use/schemas.js';
import {
  sanitizeComputerUseArguments,
  sanitizeComputerUseResultForLogs,
} from '../dist/computer-use/logging.js';

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const displays = [{
  displayId: 101,
  index: 0,
  x: 0,
  y: 0,
  width: 1440,
  height: 900,
  pixelWidth: 2880,
  pixelHeight: 1800,
  scaleFactor: 2,
  primary: true,
  visibleFrame: { x: 0, y: 25, width: 1440, height: 875 },
}];

const activeWindow = {
  applicationName: 'Safari',
  bundleIdentifier: 'com.apple.Safari',
  processId: 42,
  windowId: 9,
  title: 'Example',
  x: 0,
  y: 25,
  width: 1200,
  height: 800,
  active: true,
  frontmost: true,
  minimized: false,
  onScreen: true,
  screenIndex: 0,
};

class FakeBackend {
  constructor() {
    this.permissions = { screenRecording: true, accessibility: true, postEvents: true };
    this.calls = [];
  }
  async checkPermissions(prompt = false) { this.calls.push(['checkPermissions', prompt]); return this.permissions; }
  async getScreenInfo() { return displays; }
  async screenshot() {
    this.calls.push(['screenshot']);
    return {
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      mimeType: 'image/png',
      capturedAt: '2026-09-01T00:00:00Z',
      display: displays[0],
      pixelWidth: 2880,
      pixelHeight: 1800,
    };
  }
  async getWindows() { return [activeWindow]; }
  async getActiveWindow() { return activeWindow; }
  async getMousePosition() { return { x: 20, y: 30 }; }
  async moveMouse(value) { this.calls.push(['moveMouse', value]); }
  async click(point, button, clickCount) { this.calls.push(['click', point, button, clickCount]); }
  async mouseDown(button) { this.calls.push(['mouseDown', button]); }
  async mouseUp(button) { this.calls.push(['mouseUp', button]); }
  async drag(value) { this.calls.push(['drag', value]); }
  async scroll(value) { this.calls.push(['scroll', value]); }
  async typeText(value) { this.calls.push(['typeText', value]); }
  async pressKey(value) { this.calls.push(['pressKey', value]); }
  async hotkey(value) { this.calls.push(['hotkey', value]); }
  async getAccessibilityTree() { return { role: 'AXApplication', title: 'Safari', value: null, description: null, position: null, size: null, enabled: true, focused: true }; }
  async getFocusedElement() { return { role: 'AXTextField', title: 'Address', value: 'example', description: null, position: { x: 1, y: 2 }, size: { width: 3, height: 4 }, enabled: true, focused: true }; }
}

const enabledConfig = {
  enabled: true,
  allowScreenshots: true,
  allowMouse: true,
  allowKeyboard: true,
  allowAccessibility: true,
  allowedDisplays: [],
  allowedApps: [],
  requireConfirmationForDangerousKeys: true,
  blockDangerousTerminalText: true,
  requestTimeoutMs: 10_000,
  screenshotTimeoutMs: 20_000,
};

function makeService(backend = new FakeBackend(), overrides = {}) {
  return { backend, service: new ComputerUseService(backend, async () => ({ ...enabledConfig, ...overrides })) };
}

await test('registers the complete, unique Computer Use tool set', async () => {
  const definitions = buildComputerUseToolDefinitions();
  const names = definitions.map((tool) => tool.name);
  assert(names.length === 20, `expected 20 tools, got ${names.length}`);
  assert(new Set(names).size === names.length, 'tool names must be unique');
  for (const name of names) assert(computerUseToolArgSchemas[name], `missing schema for ${name}`);
});

await test('schemas reject invalid coordinates and malformed hotkeys', async () => {
  assert(!computerUseToolArgSchemas.computer_click.safeParse({ x: '1', y: 2 }).success, 'string coordinate was accepted');
  assert(!computerUseToolArgSchemas.computer_hotkey.safeParse({ keys: ['command'] }).success, 'single-key hotkey was accepted');
  assert(!computerUseToolArgSchemas.computer_hotkey.safeParse({ keys: ['a', 'b'] }).success, 'multi-key non-modifier hotkey was accepted');
  assert(computerUseToolArgSchemas.computer_drag.safeParse({ fromX: 0, fromY: 0, toX: 1, toY: 1 }).success, 'valid drag was rejected');
});

await test('screenshot returns a real MCP image content block and Retina metadata', async () => {
  const { service } = makeService();
  const result = await service.execute('computer_screenshot', { includeCursor: true });
  const image = result.content.find((item) => item.type === 'image');
  assert(image, 'missing image block');
  assert(image.mimeType === 'image/png', `unexpected MIME type ${image.mimeType}`);
  assert(image.data.startsWith('iVBOR'), 'PNG base64 was not preserved');
  assert(result.structuredContent.display.scaleFactor === 2, 'Retina scale factor missing');
});

await test('coordinate validation rejects off-screen points before native mouse calls', async () => {
  const { backend, service } = makeService();
  let error;
  try { await service.execute('computer_click', { x: 2000, y: 1000 }); } catch (caught) { error = caught; }
  assert(error?.code === 'INVALID_COORDINATES', `unexpected error ${error?.code}`);
  assert(!backend.calls.some(([name]) => name === 'click'), 'native click ran despite invalid coordinates');
});

await test('valid mouse and keyboard calls reach the backend', async () => {
  const { backend, service } = makeService();
  await service.execute('computer_click', { x: 100, y: 100 });
  await service.execute('computer_type', { text: 'Hello, 世界', intervalMs: 0, confirmed: false });
  assert(backend.calls.some(([name]) => name === 'click'), 'click did not reach backend');
  assert(backend.calls.some(([name, value]) => name === 'typeText' && value.text === 'Hello, 世界'), 'Unicode text did not reach backend');
});

await test('missing permissions return a clear permission error', async () => {
  const backend = new FakeBackend();
  backend.permissions = { screenRecording: false, accessibility: false, postEvents: false };
  const { service } = makeService(backend);
  let screenshotError;
  let inputError;
  try { await service.execute('computer_screenshot', { includeCursor: true }); } catch (error) { screenshotError = error; }
  try { await service.execute('computer_key', { key: 'enter', modifiers: [], confirmed: false }); } catch (error) { inputError = error; }
  assert(screenshotError?.code === 'SCREEN_RECORDING_PERMISSION_REQUIRED', 'wrong screenshot permission error');
  assert(inputError?.code === 'ACCESSIBILITY_PERMISSION_REQUIRED', 'wrong input permission error');
});

await test('dangerous hotkeys require explicit confirmation', async () => {
  const { backend, service } = makeService();
  let error;
  try { await service.execute('computer_hotkey', { keys: ['command', 'q'], confirmed: false }); } catch (caught) { error = caught; }
  assert(error?.code === 'CONFIRMATION_REQUIRED', `unexpected error ${error?.code}`);
  assert(!backend.calls.some(([name]) => name === 'hotkey'), 'dangerous hotkey reached backend without confirmation');
  await service.execute('computer_hotkey', { keys: ['command', 'q'], confirmed: true });
  assert(backend.calls.some(([name]) => name === 'hotkey'), 'confirmed hotkey did not reach backend');
});

await test('typed text and screenshot bytes are omitted from audit records', async () => {
  const sanitizedArgs = sanitizeComputerUseArguments('computer_type', { text: 'secret-token', intervalMs: 0 });
  assert(sanitizedArgs.text === '[REDACTED]', 'typed text was not redacted');
  assert(sanitizedArgs.textLength === 12, 'typed text length was not retained');
  const sanitizedResult = sanitizeComputerUseResultForLogs('computer_screenshot', {
    content: [{ type: 'image', data: 'abcdef', mimeType: 'image/png' }],
  });
  assert(!JSON.stringify(sanitizedResult).includes('abcdef'), 'image base64 leaked into audit history');
});

await test('state is fresh and remembers only the last screenshot timestamp', async () => {
  const { service } = makeService();
  await service.execute('computer_screenshot', { includeCursor: true });
  const result = await service.execute('computer_get_state', {});
  const state = result.structuredContent;
  assert(state.lastScreenshotTimestamp === '2026-09-01T00:00:00Z', 'last screenshot timestamp missing');
  assert(!JSON.stringify(state).includes('iVBOR'), 'state cached screenshot bytes');
});

if (failures > 0) process.exit(1);
console.log('All Computer Use unit tests passed.');
