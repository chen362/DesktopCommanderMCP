#!/usr/bin/env node

import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MacOSHelperProcess } from '../dist/computer-use/macos/helper-process.js';

const helperPath = fileURLToPath(new URL('./fixtures/fake-computer-use-helper.js', import.meta.url));
await chmod(helperPath, 0o755);

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
  helperPath,
  requestTimeoutMs: 250,
  screenshotTimeoutMs: 250,
};

const helper = new MacOSHelperProcess(async () => config);
try {
  const first = await helper.request('health');
  if (first.action !== 'health') throw new Error('helper IPC did not return the first response');

  let timeout;
  try { await helper.request('hang', {}, 50); } catch (error) { timeout = error; }
  if (timeout?.code !== 'HELPER_TIMEOUT') throw new Error(`expected HELPER_TIMEOUT, got ${timeout?.code}`);

  const restarted = await helper.request('health');
  if (restarted.action !== 'health') throw new Error('helper did not recover after timeout');
  if (restarted.pid === first.pid) throw new Error('timed-out helper process was not replaced');

  const extended = await helper.request('drag', { durationMs: 400, delayMs: 350 });
  if (extended.action !== 'drag') throw new Error('drag duration did not extend the helper timeout budget');

  const queued = await Promise.all([
    helper.request('queued-first', { delayMs: 180 }),
    helper.request('queued-second', { delayMs: 180 }),
  ]);
  if (queued[0].action !== 'queued-first' || queued[1].action !== 'queued-second') {
    throw new Error('concurrent helper calls were not serialized in order');
  }

  console.log('Computer Use helper IPC, serialization, timeout, and restart test passed.');
} finally {
  await helper.shutdown();
}
