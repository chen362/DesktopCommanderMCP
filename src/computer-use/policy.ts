import { ComputerUseError } from './errors.js';
import type {
  ComputerUseConfig,
  ComputerUseToolName,
  DisplayInfo,
  KeyboardModifier,
  Point,
  WindowInfo,
} from './types.js';

const SCREENSHOT_TOOLS = new Set<ComputerUseToolName>(['computer_screenshot']);
const MOUSE_TOOLS = new Set<ComputerUseToolName>([
  'computer_move_mouse', 'computer_click', 'computer_double_click',
  'computer_right_click', 'computer_mouse_down', 'computer_mouse_up',
  'computer_drag', 'computer_scroll',
]);
const KEYBOARD_TOOLS = new Set<ComputerUseToolName>([
  'computer_type', 'computer_key', 'computer_hotkey',
]);
const ACCESSIBILITY_TOOLS = new Set<ComputerUseToolName>([
  'computer_get_accessibility_tree', 'computer_get_focused_element',
]);

const DANGEROUS_HOTKEYS = new Set([
  'command+q',
  'command+w',
  'option+command+w',
  'shift+command+w',
  'command+delete',
  'command+backspace',
  'control+command+q',
  'shift+command+q',
  'option+shift+command+q',
  'option+command+escape',
  'shift+command+delete',
  'option+shift+command+delete',
]);

const TERMINAL_APPS = new Set([
  'com.apple.terminal',
  'com.googlecode.iterm2',
  'com.github.wez.wezterm',
  'com.mitchellh.ghostty',
  'co.zeit.hyper',
  'dev.warp.warp-stable',
  'net.kovidgoyal.kitty',
  'org.alacritty',
  'alacritty',
  'ghostty',
  'hyper',
  'kitty',
  'terminal',
  'iterm2',
  'warp',
  'wezterm',
]);

const PRIVILEGED_OR_POWER_COMMAND = /(?:^|[;&|\s])(?:sudo|shutdown|reboot|halt|poweroff)(?:\s|$)/i;
const RECURSIVE_FORCE_RM = /\brm\b(?=[^;&|\n]*\s--?[^\s;&|]*r[^\s;&|]*(?=\s|$|[;&|]))(?=[^;&|\n]*\s--?[^\s;&|]*f[^\s;&|]*(?=\s|$|[;&|]))/i;

function containsDangerousTerminalText(text: string): boolean {
  return PRIVILEGED_OR_POWER_COMMAND.test(text) || RECURSIVE_FORCE_RM.test(text);
}

export function assertCapabilityEnabled(toolName: ComputerUseToolName, config: ComputerUseConfig): void {
  if (!config.enabled) {
    throw new ComputerUseError(
      'COMPUTER_USE_DISABLED',
      'Computer Use is disabled. Set COMPUTER_USE_ENABLED=true or enable computerUse.enabled in configuration, then restart Desktop Commander.',
    );
  }
  if (SCREENSHOT_TOOLS.has(toolName) && !config.allowScreenshots) {
    throw new ComputerUseError('SCREENSHOT_DISABLED', 'Screenshots are disabled by the Computer Use policy.');
  }
  if (MOUSE_TOOLS.has(toolName) && !config.allowMouse) {
    throw new ComputerUseError('MOUSE_DISABLED', 'Mouse control is disabled by the Computer Use policy.');
  }
  if (KEYBOARD_TOOLS.has(toolName) && !config.allowKeyboard) {
    throw new ComputerUseError('KEYBOARD_DISABLED', 'Keyboard control is disabled by the Computer Use policy.');
  }
  if (ACCESSIBILITY_TOOLS.has(toolName) && !config.allowAccessibility) {
    throw new ComputerUseError('ACCESSIBILITY_DISABLED', 'Accessibility inspection is disabled by the Computer Use policy.');
  }
}

export function displayContainingPoint(displays: DisplayInfo[], point: Point): DisplayInfo | undefined {
  return displays.find((display) => point.x >= display.x
    && point.y >= display.y
    && point.x < display.x + display.width
    && point.y < display.y + display.height);
}

export function validatePoint(
  displays: DisplayInfo[],
  point: Point,
  allowedDisplays: number[],
): DisplayInfo {
  const display = displayContainingPoint(displays, point);
  if (!display) {
    throw new ComputerUseError(
      'INVALID_COORDINATES',
      `Coordinates (${point.x}, ${point.y}) are outside all connected displays. Refresh the layout with computer_get_screen_info.`,
      { point },
    );
  }
  if (allowedDisplays.length > 0 && !allowedDisplays.includes(display.displayId)) {
    throw new ComputerUseError(
      'DISPLAY_NOT_ALLOWED',
      `Display ${display.displayId} is not allowed by the Computer Use policy.`,
      { displayId: display.displayId },
    );
  }
  return display;
}

export function assertDisplayAllowed(displayId: number, allowedDisplays: number[]): void {
  if (allowedDisplays.length > 0 && !allowedDisplays.includes(displayId)) {
    throw new ComputerUseError(
      'DISPLAY_NOT_ALLOWED',
      `Display ${displayId} is not allowed by the Computer Use policy.`,
      { displayId },
    );
  }
}

function normalizeApp(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function isApplicationAllowed(window: WindowInfo | null, allowedApps: string[]): boolean {
  if (allowedApps.length === 0) return true;
  const allowed = new Set(allowedApps.map(normalizeApp));
  const bundle = normalizeApp(window?.bundleIdentifier);
  const name = normalizeApp(window?.applicationName);
  return !!window && (allowed.has(bundle) || allowed.has(name));
}

export function assertApplicationAllowed(window: WindowInfo | null, allowedApps: string[]): void {
  if (!isApplicationAllowed(window, allowedApps)) {
    throw new ComputerUseError(
      'APPLICATION_NOT_ALLOWED',
      `The active application ${window?.applicationName || 'could not be identified'} is not allowed by the Computer Use policy.`,
      { applicationName: window?.applicationName, bundleIdentifier: window?.bundleIdentifier },
    );
  }
}

function modifierOrder(value: string): number {
  return ['control', 'option', 'shift', 'command', 'fn'].indexOf(value);
}

export function normalizeHotkey(key: string, modifiers: KeyboardModifier[]): string {
  return [...new Set(modifiers.map((value) => value.toLowerCase()))]
    .sort((a, b) => modifierOrder(a) - modifierOrder(b))
    .concat(key.trim().toLowerCase())
    .join('+');
}

export function normalizeHotkeyKeys(keys: string[]): string {
  const modifiers = keys
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is KeyboardModifier => ['command', 'control', 'option', 'shift', 'fn'].includes(value));
  const nonModifiers = keys
    .map((value) => value.trim().toLowerCase())
    .filter((value) => !['command', 'control', 'option', 'shift', 'fn'].includes(value));
  return nonModifiers.length === 1 ? normalizeHotkey(nonModifiers[0], modifiers) : keys.join('+').toLowerCase();
}

export function assertHotkeyConfirmed(
  normalizedHotkey: string,
  confirmed: boolean,
  config: ComputerUseConfig,
): void {
  if (config.requireConfirmationForDangerousKeys
    && DANGEROUS_HOTKEYS.has(normalizedHotkey)
    && !confirmed) {
    throw new ComputerUseError(
      'CONFIRMATION_REQUIRED',
      `The hotkey ${normalizedHotkey} can close or lock user work. Obtain explicit user confirmation, then call again with confirmed=true.`,
      { hotkey: normalizedHotkey },
    );
  }
}

export function assertTerminalTextAllowed(
  text: string,
  activeWindow: WindowInfo | null,
  confirmed: boolean,
  config: ComputerUseConfig,
): void {
  if (!config.blockDangerousTerminalText || confirmed || !containsDangerousTerminalText(text)) return;
  const appIdentifiers = [activeWindow?.bundleIdentifier, activeWindow?.applicationName].map(normalizeApp);
  if (appIdentifiers.some((value) => TERMINAL_APPS.has(value))) {
    throw new ComputerUseError(
      'CONFIRMATION_REQUIRED',
      'The text appears to contain a destructive system command and the active application is a terminal. Obtain explicit user confirmation, then call again with confirmed=true.',
    );
  }
}
