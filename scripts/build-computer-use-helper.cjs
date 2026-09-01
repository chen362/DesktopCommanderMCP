#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src', 'computer-use', 'macos', 'native', 'ComputerUseHelper.swift');
const destinationDirectory = path.join(root, 'dist', 'computer-use', 'macos', 'native');
const destination = path.join(destinationDirectory, 'ComputerUseHelper.swift');

fs.mkdirSync(destinationDirectory, { recursive: true });
fs.copyFileSync(source, destination);
console.log(`Copied Computer Use helper source to ${path.relative(root, destination)}`);

if (!process.argv.includes('--compile')) process.exit(0);
if (process.platform !== 'darwin') {
  console.log('Skipping native Computer Use helper compilation on non-macOS platform.');
  process.exit(0);
}

const output = path.join(destinationDirectory, 'computer-use-helper');
const result = spawnSync('/usr/bin/xcrun', [
  'swiftc', destination, '-O', '-o', output,
  '-framework', 'AppKit',
  '-framework', 'ApplicationServices',
  '-framework', 'CoreGraphics',
  '-framework', 'ImageIO',
  '-framework', 'ScreenCaptureKit',
  '-framework', 'UniformTypeIdentifiers',
], { stdio: 'inherit' });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
fs.chmodSync(output, 0o755);
console.log(`Compiled Computer Use helper to ${path.relative(root, output)}`);
