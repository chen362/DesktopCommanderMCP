#!/usr/bin/env node

if (process.platform !== 'darwin') {
  console.log('SKIP macOS Computer Use integration test: non-macOS host.');
  process.exit(0);
}
if (process.env.COMPUTER_USE_INTEGRATION !== '1') {
  console.log('SKIP macOS Computer Use integration test: set COMPUTER_USE_INTEGRATION=1 to run read-only native checks.');
  process.exit(0);
}

const { MacOSComputerUseBackend } = await import('../../dist/computer-use/macos/backend.js');

const config = {
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
const backend = new MacOSComputerUseBackend(async () => config);

try {
  const permissions = await backend.checkPermissions(false);
  const displays = await backend.getScreenInfo();
  if (displays.length === 0) throw new Error('No displays returned');

  if (permissions.screenRecording) {
    const screenshot = await backend.screenshot({ includeCursor: true });
    if (screenshot.mimeType !== 'image/png' || !screenshot.data.startsWith('iVBOR')) {
      throw new Error('Screenshot was not a PNG MCP payload');
    }
  } else {
    console.log('SKIP screenshot assertion: Screen Recording permission is not granted.');
  }

  const mouse = await backend.getMousePosition();
  if (!Number.isFinite(mouse.x) || !Number.isFinite(mouse.y)) throw new Error('Invalid mouse coordinates');

  if (process.env.COMPUTER_USE_INTEGRATION_MUTATIONS === '1') {
    if (!permissions.postEvents) {
      throw new Error('Mutation checks requested but Post Events permission is not granted');
    }
    const guard = { allowedDisplayIds: [] };
    await backend.moveMouse(mouse, guard);
    await backend.mouseDown('left', guard);
    await backend.mouseUp('left');
    await backend.pressKey({ key: 'escape', modifiers: [], guard });
    if (process.env.COMPUTER_USE_INTEGRATION_TYPE_TEXT === '1') {
      await backend.typeText({ text: 'desktop-commander-computer-use-test', intervalMs: 0, guard });
    } else {
      console.log('SKIP native Unicode typing: set COMPUTER_USE_INTEGRATION_TYPE_TEXT=1 in a disposable focused text field.');
    }
  } else {
    console.log('SKIP native mouse/keyboard mutations: set COMPUTER_USE_INTEGRATION_MUTATIONS=1 in a safe test session.');
  }

  console.log('macOS Computer Use integration checks passed.');
} finally {
  await backend.shutdown();
}
