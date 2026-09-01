import { configManager } from '../config-manager.js';
import type { ComputerUseConfig } from './types.js';

export const DEFAULT_COMPUTER_USE_CONFIG: Readonly<ComputerUseConfig> = {
  enabled: false,
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

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function parseStringList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseDisplayList(value: string | undefined): number[] | undefined {
  const items = parseStringList(value);
  if (items === undefined) return undefined;
  return items.map(Number).filter((item) => Number.isInteger(item) && item >= 0);
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export async function getComputerUseConfig(): Promise<ComputerUseConfig> {
  const stored = await configManager.getValue('computerUse');
  const configured = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored as Partial<ComputerUseConfig>
    : {};

  const result: ComputerUseConfig = {
    ...DEFAULT_COMPUTER_USE_CONFIG,
    ...configured,
    enabled: booleanValue(configured.enabled, DEFAULT_COMPUTER_USE_CONFIG.enabled),
    allowScreenshots: booleanValue(configured.allowScreenshots, DEFAULT_COMPUTER_USE_CONFIG.allowScreenshots),
    allowMouse: booleanValue(configured.allowMouse, DEFAULT_COMPUTER_USE_CONFIG.allowMouse),
    allowKeyboard: booleanValue(configured.allowKeyboard, DEFAULT_COMPUTER_USE_CONFIG.allowKeyboard),
    allowAccessibility: booleanValue(configured.allowAccessibility, DEFAULT_COMPUTER_USE_CONFIG.allowAccessibility),
    requireConfirmationForDangerousKeys: booleanValue(
      configured.requireConfirmationForDangerousKeys,
      DEFAULT_COMPUTER_USE_CONFIG.requireConfirmationForDangerousKeys,
    ),
    blockDangerousTerminalText: booleanValue(
      configured.blockDangerousTerminalText,
      DEFAULT_COMPUTER_USE_CONFIG.blockDangerousTerminalText,
    ),
    allowedDisplays: Array.isArray(configured.allowedDisplays)
      ? configured.allowedDisplays.filter((value): value is number => Number.isInteger(value) && value >= 0)
      : [],
    allowedApps: Array.isArray(configured.allowedApps)
      ? configured.allowedApps.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [],
    requestTimeoutMs: positiveInteger(configured.requestTimeoutMs, DEFAULT_COMPUTER_USE_CONFIG.requestTimeoutMs),
    screenshotTimeoutMs: positiveInteger(configured.screenshotTimeoutMs, DEFAULT_COMPUTER_USE_CONFIG.screenshotTimeoutMs),
    helperPath: typeof configured.helperPath === 'string' && configured.helperPath.trim()
      ? configured.helperPath.trim()
      : undefined,
  };

  const environmentOverrides: Partial<ComputerUseConfig> = {
    enabled: parseBoolean(process.env.COMPUTER_USE_ENABLED),
    allowScreenshots: parseBoolean(process.env.COMPUTER_USE_ALLOW_SCREENSHOTS),
    allowMouse: parseBoolean(process.env.COMPUTER_USE_ALLOW_MOUSE),
    allowKeyboard: parseBoolean(process.env.COMPUTER_USE_ALLOW_KEYBOARD),
    allowAccessibility: parseBoolean(process.env.COMPUTER_USE_ALLOW_ACCESSIBILITY),
    allowedDisplays: parseDisplayList(process.env.COMPUTER_USE_ALLOWED_DISPLAYS),
    allowedApps: parseStringList(process.env.COMPUTER_USE_ALLOWED_APPS),
    helperPath: process.env.COMPUTER_USE_HELPER_PATH?.trim() || undefined,
  };

  for (const [key, value] of Object.entries(environmentOverrides)) {
    if (value !== undefined) {
      (result as unknown as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

export function isComputerUsePlatformSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin';
}

export function isComputerUseContainer(): boolean {
  return process.env.MCP_CLIENT_DOCKER === 'true'
    || process.env.CONTAINER === 'true'
    || process.env.DOCKER_CONTAINER === 'true';
}

export async function shouldExposeComputerUseTools(
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const config = await getComputerUseConfig();
  return config.enabled && isComputerUsePlatformSupported(platform) && !isComputerUseContainer();
}
