#!/usr/bin/env node

import { ComputerUseService } from '../dist/computer-use/service.js';
import { buildComputerUseToolDefinitions } from '../dist/computer-use/tools.js';
import { getComputerUseConfig } from '../dist/computer-use/config.js';
import { ComputerUseConfigValueSchema, computerUseToolArgSchemas } from '../dist/computer-use/schemas.js';
import { configManager } from '../dist/config-manager.js';
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
  displayId: 101,
};

class FakeBackend {
  constructor() {
    this.permissions = { screenRecording: true, accessibility: true, postEvents: true };
    this.calls = [];
    this.displays = displays;
    this.windows = [activeWindow];
    this.activeWindow = activeWindow;
  }
  async checkPermissions(prompt = false) { this.calls.push(['checkPermissions', prompt]); return this.permissions; }
  async getScreenInfo() { return this.displays; }
  async screenshot(args = {}) {
    this.calls.push(['screenshot', args]);
    const display = this.displays.find((candidate) => candidate.displayId === args.displayId)
      ?? this.displays.find((candidate) => candidate.primary)
      ?? this.displays[0];
    return {
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      mimeType: 'image/png',
      capturedAt: '2026-09-01T00:00:00Z',
      display,
      pixelWidth: display.pixelWidth,
      pixelHeight: display.pixelHeight,
    };
  }
  async getWindows(args = {}) {
    this.calls.push(['getWindows', args]);
    return this.windows.slice(0, args.limit ?? this.windows.length);
  }
  async getActiveWindow() { return this.activeWindow; }
  async getMousePosition() { return { x: 20, y: 30 }; }
  async moveMouse(value, guard) { this.calls.push(['moveMouse', value, guard]); }
  async click(point, button, clickCount, guard) { this.calls.push(['click', point, button, clickCount, guard]); }
  async mouseDown(button, guard) { this.calls.push(['mouseDown', button, guard]); }
  async mouseUp(button) { this.calls.push(['mouseUp', button]); }
  async drag(value) { this.calls.push(['drag', value]); }
  async scroll(value) { this.calls.push(['scroll', value]); }
  async typeText(value) { this.calls.push(['typeText', value]); }
  async pressKey(value) { this.calls.push(['pressKey', value]); }
  async hotkey(value) { this.calls.push(['hotkey', value]); }
  async getAccessibilityTree(value) { this.calls.push(['getAccessibilityTree', value]); return { role: 'AXApplication', subrole: null, title: 'Safari', value: null, description: null, position: null, size: null, enabled: true, focused: true }; }
  async getFocusedElement(value) { this.calls.push(['getFocusedElement', value]); return { role: 'AXTextField', subrole: null, title: 'Address', value: 'example', description: null, position: { x: 1, y: 2 }, size: { width: 3, height: 4 }, enabled: true, focused: true }; }
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
  assert(!ComputerUseConfigValueSchema.safeParse({ helperPath: '/tmp/untrusted-helper' }).success, 'MCP configuration accepted an executable helper path');
  assert(!ComputerUseConfigValueSchema.safeParse({ allowedDisplays: [0x1_0000_0000] }).success, 'out-of-range display ID was accepted');
  assert(!ComputerUseConfigValueSchema.safeParse({ allowedApps: ['   '] }).success, 'blank application allowlist item was accepted');
  assert(!computerUseToolArgSchemas.computer_hotkey.safeParse({ keys: ['command', '   '] }).success, 'blank hotkey key was accepted');
  assert(!computerUseToolArgSchemas.computer_type.safeParse({ text: 'x'.repeat(32), intervalMs: 1000 }).success, 'typing request longer than 30 seconds was accepted');
});

await test('tool annotations identify prompts and potentially destructive desktop actions', async () => {
  const definitions = new Map(buildComputerUseToolDefinitions().map((tool) => [tool.name, tool]));
  assert(definitions.get('computer_check_permissions').annotations.readOnlyHint === false, 'permission prompt was marked read-only');
  assert(definitions.get('computer_click').annotations.destructiveHint === true, 'click was not marked potentially destructive');
  assert(definitions.get('computer_type').annotations.destructiveHint === true, 'typing was not marked potentially destructive');
  assert(definitions.get('computer_move_mouse').annotations.destructiveHint === false, 'pointer movement was marked destructive');
});

await test('invalid stored allowlists fail closed instead of becoming unrestricted', async () => {
  const originalGetValue = configManager.getValue;
  configManager.getValue = async () => ({ enabled: true, allowedApps: [42] });
  let error;
  try {
    await getComputerUseConfig();
  } catch (caught) {
    error = caught;
  } finally {
    configManager.getValue = originalGetValue;
  }
  assert(error?.code === 'INVALID_CONFIGURATION', `unexpected configuration error ${error?.code}`);
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

await test('screenshot selects an allowed connected display before capture', async () => {
  const backend = new FakeBackend();
  backend.displays = [
    ...displays,
    {
      ...displays[0],
      displayId: 202,
      index: 1,
      x: 1440,
      primary: false,
      visibleFrame: { ...displays[0].visibleFrame, x: 1440 },
    },
  ];
  const { service } = makeService(backend, { allowedDisplays: [202] });
  const result = await service.execute('computer_screenshot', { includeCursor: false });
  const screenshotCall = backend.calls.find(([name]) => name === 'screenshot');
  assert(screenshotCall?.[1]?.displayId === 202, 'capture ran without first resolving the allowed display');
  assert(result.structuredContent.display.displayId === 202, 'result came from a disallowed display');
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
  const clickCall = backend.calls.find(([name]) => name === 'click');
  const typeCall = backend.calls.find(([name]) => name === 'typeText');
  assert(clickCall, 'click did not reach backend');
  assert(clickCall[4].expectedProcessId === 42 && clickCall[4].expectedWindowId === 9, 'click target identity was not guarded');
  assert(typeCall?.[1]?.text === 'Hello, 世界', 'Unicode text did not reach backend');
  assert(typeCall[1].guard.expectedProcessId === 42 && typeCall[1].guard.expectedWindowId === 9, 'typing target identity was not guarded');
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
  assert(inputError?.code === 'POST_EVENT_PERMISSION_REQUIRED', 'wrong input permission error');
});

await test('Accessibility trust alone cannot authorize event posting', async () => {
  const backend = new FakeBackend();
  backend.permissions = { screenRecording: true, accessibility: true, postEvents: false };
  const { service } = makeService(backend);
  let error;
  try { await service.execute('computer_key', { key: 'enter', modifiers: [], confirmed: false }); } catch (caught) { error = caught; }
  assert(error?.code === 'POST_EVENT_PERMISSION_REQUIRED', `unexpected error ${error?.code}`);
  assert(!backend.calls.some(([name]) => name === 'pressKey'), 'keyboard event ran without Post Events permission');
});

await test('application and display allowlists filter metadata and Accessibility reads', async () => {
  const { backend, service } = makeService(undefined, { allowedApps: ['com.example.Allowed'] });
  const windows = await service.execute('computer_get_windows', { onScreenOnly: true, limit: 100 });
  assert(windows.structuredContent.windows.length === 0, 'disallowed window metadata was returned');
  let error;
  try { await service.execute('computer_get_accessibility_tree', { maxDepth: 1, maxNodes: 10 }); } catch (caught) { error = caught; }
  assert(error?.code === 'APPLICATION_NOT_ALLOWED', `unexpected Accessibility policy error ${error?.code}`);
  assert(!backend.calls.some(([name]) => name === 'getAccessibilityTree'), 'Accessibility tree was read for a disallowed app');
});

await test('window filtering applies the requested limit after policy filtering', async () => {
  const backend = new FakeBackend();
  backend.windows = [
    activeWindow,
    {
      ...activeWindow,
      applicationName: 'Allowed',
      bundleIdentifier: 'com.example.Allowed',
      processId: 43,
      windowId: 10,
    },
  ];
  const { service } = makeService(backend, { allowedApps: ['com.example.Allowed'] });
  const result = await service.execute('computer_get_windows', { onScreenOnly: true, limit: 1 });
  assert(result.structuredContent.windows.length === 1, 'allowed window was lost before the result limit was applied');
  assert(result.structuredContent.windows[0].processId === 43, 'wrong window survived policy filtering');
});

await test('mouse-up remains available after the pointer target or display changes', async () => {
  const { backend, service } = makeService(undefined, {
    allowedApps: ['com.example.Allowed'],
    allowedDisplays: [202],
  });
  await service.execute('computer_mouse_up', { button: 'left' });
  assert(backend.calls.some(([name]) => name === 'mouseUp'), 'release was blocked by target policy');
});

await test('dangerous hotkeys require explicit confirmation', async () => {
  const { backend, service } = makeService();
  let error;
  try { await service.execute('computer_hotkey', { keys: ['command', 'q'], confirmed: false }); } catch (caught) { error = caught; }
  assert(error?.code === 'CONFIRMATION_REQUIRED', `unexpected error ${error?.code}`);
  assert(!backend.calls.some(([name]) => name === 'hotkey'), 'dangerous hotkey reached backend without confirmation');
  await service.execute('computer_hotkey', { keys: ['command', 'q'], confirmed: true });
  assert(backend.calls.some(([name]) => name === 'hotkey'), 'confirmed hotkey did not reach backend');

  let closeAllError;
  try { await service.execute('computer_hotkey', { keys: ['command', 'option', 'w'], confirmed: false }); } catch (caught) { closeAllError = caught; }
  assert(closeAllError?.code === 'CONFIRMATION_REQUIRED', 'close-all-windows hotkey did not require confirmation');
});

await test('equivalent recursive-force rm flag orders require confirmation in terminals', async () => {
  const backend = new FakeBackend();
  backend.activeWindow = {
    ...activeWindow,
    applicationName: 'Terminal',
    bundleIdentifier: 'com.apple.Terminal',
  };
  const { service } = makeService(backend);
  let error;
  try { await service.execute('computer_type', { text: 'rm -fr /tmp/example', intervalMs: 0, confirmed: false }); } catch (caught) { error = caught; }
  assert(error?.code === 'CONFIRMATION_REQUIRED', 'rm -fr was not recognized as recursive-force removal');
  assert(!backend.calls.some(([name]) => name === 'typeText'), 'dangerous terminal text reached backend without confirmation');
});

await test('hotkey modifiers are normalized before the native call', async () => {
  const { backend, service } = makeService();
  await service.execute('computer_hotkey', { keys: [' Command ', 'space'], confirmed: false });
  const call = backend.calls.find(([name]) => name === 'hotkey');
  assert(call?.[1]?.keys?.[0] === 'command', 'whitespace/case-normalized modifier did not reach the backend');
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
