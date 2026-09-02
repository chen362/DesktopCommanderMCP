import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComputerUseError, type ComputerUseErrorCode } from '../errors.js';
import type { ComputerUseConfig } from '../types.js';

interface NativeResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const NATIVE_ERROR_CODES = new Set<ComputerUseErrorCode>([
  'SCREEN_RECORDING_PERMISSION_REQUIRED',
  'ACCESSIBILITY_PERMISSION_REQUIRED',
  'POST_EVENT_PERMISSION_REQUIRED',
  'INVALID_COORDINATES',
  'DISPLAY_NOT_ALLOWED',
  'APPLICATION_NOT_ALLOWED',
  'TARGET_CHANGED',
  'NATIVE_OPERATION_FAILED',
]);

function asNativeErrorCode(value: string | undefined): ComputerUseErrorCode {
  return value && NATIVE_ERROR_CODES.has(value as ComputerUseErrorCode)
    ? value as ComputerUseErrorCode
    : 'NATIVE_OPERATION_FAILED';
}

function nativeSourcePath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.join(path.dirname(currentFile), 'native', 'ComputerUseHelper.swift');
}

function minimumOperationTimeout(action: string, params: Record<string, unknown>): number {
  const safetyMarginMs = 5_000;
  if (action === 'drag' && typeof params.durationMs === 'number' && Number.isFinite(params.durationMs)) {
    return Math.max(0, params.durationMs) + safetyMarginMs;
  }
  if (action === 'typeText' && typeof params.text === 'string'
    && typeof params.intervalMs === 'number' && Number.isFinite(params.intervalMs)) {
    const intervals = Math.max(0, Array.from(params.text).length - 1);
    return intervals * Math.max(0, params.intervalMs) + safetyMarginMs;
  }
  return 0;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function runCompiler(args: string[], timeoutMs = 120_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/bin/xcrun', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new ComputerUseError('HELPER_TIMEOUT', 'Timed out while compiling the macOS Computer Use helper.'));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 32_000) stderr = stderr.slice(-32_000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new ComputerUseError(
        'HELPER_UNAVAILABLE',
        `Could not start xcrun to compile the Computer Use helper: ${error.message}. Install the Xcode Command Line Tools with xcode-select --install.`,
      ));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new ComputerUseError(
        'HELPER_UNAVAILABLE',
        `The macOS Computer Use helper failed to compile (exit ${code ?? 'unknown'}): ${stderr.trim() || 'no compiler output'}`,
      ));
    });
  });
}

async function resolveHelperBinary(config: ComputerUseConfig): Promise<string> {
  if (config.helperPath) {
    if (!await isExecutable(config.helperPath)) {
      throw new ComputerUseError(
        'HELPER_UNAVAILABLE',
        `COMPUTER_USE_HELPER_PATH does not point to an executable file: ${config.helperPath}`,
      );
    }
    return config.helperPath;
  }
  if (process.platform !== 'darwin') {
    throw new ComputerUseError('UNSUPPORTED_PLATFORM', 'Computer Use is currently implemented only for macOS.');
  }

  const sourcePath = nativeSourcePath();
  const adjacentBinary = path.join(path.dirname(sourcePath), 'computer-use-helper');
  if (await isExecutable(adjacentBinary)) return adjacentBinary;
  let source: Buffer;
  try {
    source = await readFile(sourcePath);
  } catch (error) {
    throw new ComputerUseError(
      'HELPER_UNAVAILABLE',
      `The packaged Swift helper source is missing at ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const digest = createHash('sha256')
    .update(source)
    .update(process.arch)
    .digest('hex');
  const cacheDir = path.join(os.homedir(), '.desktop-commander', 'bin');
  const binaryPath = path.join(cacheDir, 'computer-use-helper');
  const digestPath = `${binaryPath}.sha256`;
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });

  try {
    const savedDigest = (await readFile(digestPath, 'utf8')).trim();
    if (savedDigest === digest && await isExecutable(binaryPath)) return binaryPath;
  } catch {
    // First run or stale cache.
  }

  const temporaryPath = `${binaryPath}.${process.pid}.tmp`;
  await rm(temporaryPath, { force: true });
  await runCompiler([
    'swiftc', sourcePath, '-parse-as-library', '-O', '-o', temporaryPath,
    '-framework', 'AppKit',
    '-framework', 'ApplicationServices',
    '-framework', 'CoreGraphics',
    '-framework', 'ImageIO',
    '-framework', 'ScreenCaptureKit',
    '-framework', 'UniformTypeIdentifiers',
  ]);
  await chmod(temporaryPath, 0o700);
  await rm(binaryPath, { force: true });
  await rename(temporaryPath, binaryPath);
  await writeFile(digestPath, `${digest}\n`, { mode: 0o600 });
  return binaryPath;
}

export class MacOSHelperProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private requestQueue: Promise<void> = Promise.resolve();
  private nextId = 1;
  private stdoutBuffer = '';
  private pending = new Map<string, PendingRequest>();
  private stopping = false;

  constructor(private readonly configProvider: () => Promise<ComputerUseConfig>) {}

  private async ensureStarted(): Promise<void> {
    if (this.child && this.child.exitCode === null && !this.child.killed) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start().finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  private async start(): Promise<void> {
    this.stopping = false;
    const config = await this.configProvider();
    const binaryPath = await resolveHelperBinary(config);
    const child = spawn(binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: process.env.LC_ALL || 'en_US.UTF-8' },
    });
    this.child = child;
    this.stdoutBuffer = '';

    child.stdout.on('data', (chunk) => this.consumeStdout(chunk.toString()));
    child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (message) console.error(`[Computer Use helper] ${message}`);
    });
    child.once('error', (error) => this.handleExit(child,
      new ComputerUseError('HELPER_UNAVAILABLE', `Failed to start the macOS Computer Use helper: ${error.message}`),
    ));
    child.once('exit', (code, signal) => {
      if (this.stopping) return;
      this.handleExit(child, new ComputerUseError(
        'HELPER_UNAVAILABLE',
        `The macOS Computer Use helper exited unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'}). It will restart on the next call.`,
      ));
    });

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (this.stdoutBuffer.length > 64 * 1024 * 1024) {
      const child = this.child;
      if (child) {
        this.handleExit(child, new ComputerUseError('NATIVE_OPERATION_FAILED', 'Computer Use helper returned an oversized response.'));
        child.kill('SIGKILL');
      }
      return;
    }
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let response: NativeResponse;
      try {
        response = JSON.parse(line) as NativeResponse;
      } catch {
        continue;
      }
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.ok) {
        pending.resolve(response.result);
      } else {
        pending.reject(new ComputerUseError(
          asNativeErrorCode(response.error?.code),
          response.error?.message || 'The macOS Computer Use helper reported an unknown error.',
          response.error?.details,
        ));
      }
    }
  }

  private handleExit(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return;
    this.child = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async requestOnce<T>(
    action: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    await this.ensureStarted();
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new ComputerUseError('HELPER_UNAVAILABLE', 'The macOS Computer Use helper is not running.');
    }
    const config = await this.configProvider();
    const id = `${process.pid}-${this.nextId++}`;
    const configuredTimeout = timeoutMs
      ?? (action === 'screenshot' ? config.screenshotTimeoutMs : config.requestTimeoutMs);
    const effectiveTimeout = Math.max(configuredTimeout, minimumOperationTimeout(action, params));

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const timeoutError = new ComputerUseError(
          'HELPER_TIMEOUT',
          `The macOS Computer Use helper timed out after ${effectiveTimeout}ms while running ${action}. The operation was not retried.`,
          { action, timeoutMs: effectiveTimeout },
        );
        this.handleExit(child, timeoutError);
        child.kill('SIGKILL');
      }, effectiveTimeout);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, action, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new ComputerUseError('HELPER_UNAVAILABLE', `Could not send ${action} to the Computer Use helper: ${error.message}`));
      });
    });
  }

  request<T>(action: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    const operation = this.requestQueue.then(() => this.requestOnce<T>(action, params, timeoutMs));
    this.requestQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.kill('SIGTERM');
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ComputerUseError('HELPER_UNAVAILABLE', 'Computer Use helper shut down.'));
    }
    this.pending.clear();
  }
}
