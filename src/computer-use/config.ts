import { configManager } from '../config-manager.js';
import { ComputerUseError } from './errors.js';
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

const MAX_DISPLAY_ID = 0xFFFF_FFFF;

function invalidConfiguration(message: string): never {
  throw new ComputerUseError('INVALID_CONFIGURATION', message);
}

function parseBoolean(value: string | undefined, variableName: string): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return invalidConfiguration(`${variableName} must be true/false, 1/0, yes/no, or on/off.`);
}

function parseStringList(value: string | undefined, variableName: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === '') return [];
  const items = value.split(',').map((item) => item.trim());
  if (items.some((item) => item.length === 0)) {
    return invalidConfiguration(`${variableName} contains an empty list item.`);
  }
  return [...new Set(items)];
}

function parseDisplayList(value: string | undefined): number[] | undefined {
  const items = parseStringList(value, 'COMPUTER_USE_ALLOWED_DISPLAYS');
  if (items === undefined) return undefined;
  const result = items.map((item) => Number(item));
  if (items.some((item) => !/^\d+$/.test(item))
    || result.some((item) => !Number.isSafeInteger(item) || item < 0 || item > MAX_DISPLAY_ID)) {
    return invalidConfiguration('COMPUTER_USE_ALLOWED_DISPLAYS must contain only comma-separated Core Graphics display IDs.');
  }
  return [...new Set(result)];
}

function configuredPositiveInteger(value: unknown, key: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 120_000) {
    return invalidConfiguration(`computerUse.${key} must be an integer from 100 through 120000.`);
  }
  return value;
}

function configuredBoolean(value: unknown, key: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    return invalidConfiguration(`computerUse.${key} must be a boolean.`);
  }
  return value;
}

function configuredDisplays(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)
    || value.some((item) => !Number.isSafeInteger(item) || item < 0 || item > MAX_DISPLAY_ID)) {
    return invalidConfiguration('computerUse.allowedDisplays must contain only Core Graphics display IDs.');
  }
  return [...new Set(value as number[])];
}

function configuredApps(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)
    || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    return invalidConfiguration('computerUse.allowedApps must contain only non-empty application names or bundle identifiers.');
  }
  return [...new Set((value as string[]).map((item) => item.trim()))];
}

export async function getComputerUseConfig(): Promise<ComputerUseConfig> {
  const stored = await configManager.getValue('computerUse');
  const configured = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored as Partial<ComputerUseConfig>
    : {};

  const result: ComputerUseConfig = {
    ...DEFAULT_COMPUTER_USE_CONFIG,
    enabled: configuredBoolean(configured.enabled, 'enabled', DEFAULT_COMPUTER_USE_CONFIG.enabled),
    allowScreenshots: configuredBoolean(
      configured.allowScreenshots,
      'allowScreenshots',
      DEFAULT_COMPUTER_USE_CONFIG.allowScreenshots,
    ),
    allowMouse: configuredBoolean(configured.allowMouse, 'allowMouse', DEFAULT_COMPUTER_USE_CONFIG.allowMouse),
    allowKeyboard: configuredBoolean(configured.allowKeyboard, 'allowKeyboard', DEFAULT_COMPUTER_USE_CONFIG.allowKeyboard),
    allowAccessibility: configuredBoolean(
      configured.allowAccessibility,
      'allowAccessibility',
      DEFAULT_COMPUTER_USE_CONFIG.allowAccessibility,
    ),
    requireConfirmationForDangerousKeys: configuredBoolean(
      configured.requireConfirmationForDangerousKeys,
      'requireConfirmationForDangerousKeys',
      DEFAULT_COMPUTER_USE_CONFIG.requireConfirmationForDangerousKeys,
    ),
    blockDangerousTerminalText: configuredBoolean(
      configured.blockDangerousTerminalText,
      'blockDangerousTerminalText',
      DEFAULT_COMPUTER_USE_CONFIG.blockDangerousTerminalText,
    ),
    allowedDisplays: configuredDisplays(configured.allowedDisplays),
    allowedApps: configuredApps(configured.allowedApps),
    requestTimeoutMs: configuredPositiveInteger(
      configured.requestTimeoutMs,
      'requestTimeoutMs',
      DEFAULT_COMPUTER_USE_CONFIG.requestTimeoutMs,
    ),
    screenshotTimeoutMs: configuredPositiveInteger(
      configured.screenshotTimeoutMs,
      'screenshotTimeoutMs',
      DEFAULT_COMPUTER_USE_CONFIG.screenshotTimeoutMs,
    ),
  };

  const environmentOverrides: Partial<ComputerUseConfig> = {
    enabled: parseBoolean(process.env.COMPUTER_USE_ENABLED, 'COMPUTER_USE_ENABLED'),
    allowScreenshots: parseBoolean(process.env.COMPUTER_USE_ALLOW_SCREENSHOTS, 'COMPUTER_USE_ALLOW_SCREENSHOTS'),
    allowMouse: parseBoolean(process.env.COMPUTER_USE_ALLOW_MOUSE, 'COMPUTER_USE_ALLOW_MOUSE'),
    allowKeyboard: parseBoolean(process.env.COMPUTER_USE_ALLOW_KEYBOARD, 'COMPUTER_USE_ALLOW_KEYBOARD'),
    allowAccessibility: parseBoolean(
      process.env.COMPUTER_USE_ALLOW_ACCESSIBILITY,
      'COMPUTER_USE_ALLOW_ACCESSIBILITY',
    ),
    allowedDisplays: parseDisplayList(process.env.COMPUTER_USE_ALLOWED_DISPLAYS),
    allowedApps: parseStringList(process.env.COMPUTER_USE_ALLOWED_APPS, 'COMPUTER_USE_ALLOWED_APPS'),
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
  try {
    const config = await getComputerUseConfig();
    return config.enabled && isComputerUsePlatformSupported(platform) && !isComputerUseContainer();
  } catch (error) {
    console.error(`[Computer Use] Tools hidden because configuration is invalid: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
