import type { ServerResult } from '../types.js';

export const COMPUTER_USE_TOOL_NAMES = [
  'computer_check_permissions',
  'computer_get_screen_info',
  'computer_screenshot',
  'computer_get_windows',
  'computer_get_active_window',
  'computer_get_mouse_position',
  'computer_move_mouse',
  'computer_click',
  'computer_double_click',
  'computer_right_click',
  'computer_mouse_down',
  'computer_mouse_up',
  'computer_drag',
  'computer_scroll',
  'computer_type',
  'computer_key',
  'computer_hotkey',
  'computer_get_state',
  'computer_get_accessibility_tree',
  'computer_get_focused_element',
] as const;

export type ComputerUseToolName = typeof COMPUTER_USE_TOOL_NAMES[number];
export type MouseButton = 'left' | 'right' | 'middle';
export type KeyboardModifier = 'command' | 'control' | 'option' | 'shift' | 'fn';

export interface ComputerUseConfig {
  enabled: boolean;
  allowScreenshots: boolean;
  allowMouse: boolean;
  allowKeyboard: boolean;
  allowAccessibility: boolean;
  allowedDisplays: number[];
  allowedApps: string[];
  requireConfirmationForDangerousKeys: boolean;
  blockDangerousTerminalText: boolean;
  helperPath?: string;
  requestTimeoutMs: number;
  screenshotTimeoutMs: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface NativeTargetGuard {
  allowedDisplayIds: number[];
  expectedProcessId?: number;
  expectedWindowId?: number;
  expectedDestinationProcessId?: number;
  expectedDestinationWindowId?: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface DisplayInfo extends Rect {
  displayId: number;
  index: number;
  pixelWidth: number;
  pixelHeight: number;
  scaleFactor: number;
  primary: boolean;
  visibleFrame: Rect;
}

export interface PermissionInfo {
  screenRecording: boolean;
  accessibility: boolean;
  postEvents: boolean;
}

export interface ScreenshotResult {
  data: string;
  mimeType: 'image/png';
  capturedAt: string;
  display: DisplayInfo;
  pixelWidth: number;
  pixelHeight: number;
}

export interface WindowInfo extends Rect {
  applicationName: string;
  bundleIdentifier: string | null;
  processId: number;
  windowId: number | null;
  title: string;
  active: boolean;
  frontmost: boolean;
  minimized: boolean;
  onScreen: boolean;
  screenIndex: number | null;
  displayId: number | null;
}

export interface AccessibilityTruncation {
  truncated: true;
}

export interface AccessibilityNode {
  role: string | null;
  subrole: string | null;
  title: string | null;
  value: unknown;
  description: string | null;
  position: Point | null;
  size: { width: number; height: number } | null;
  enabled: boolean | null;
  focused: boolean | null;
  children?: Array<AccessibilityNode | AccessibilityTruncation>;
}

export interface ComputerUseBackend {
  checkPermissions(prompt?: boolean): Promise<PermissionInfo>;
  getScreenInfo(): Promise<DisplayInfo[]>;
  screenshot(args: { displayId?: number; includeCursor?: boolean }): Promise<ScreenshotResult>;
  getWindows(args: { onScreenOnly?: boolean; limit?: number }): Promise<WindowInfo[]>;
  getActiveWindow(): Promise<WindowInfo | null>;
  getMousePosition(): Promise<Point>;
  moveMouse(point: Point, guard: NativeTargetGuard): Promise<void>;
  click(point: Point, button: MouseButton, clickCount: 1 | 2, guard: NativeTargetGuard): Promise<void>;
  mouseDown(button: MouseButton, guard: NativeTargetGuard): Promise<void>;
  mouseUp(button: MouseButton): Promise<void>;
  drag(args: { from: Point; to: Point; button: MouseButton; durationMs: number; guard: NativeTargetGuard }): Promise<void>;
  scroll(args: { deltaX: number; deltaY: number; guard: NativeTargetGuard }): Promise<void>;
  typeText(args: { text: string; intervalMs: number; guard: NativeTargetGuard }): Promise<void>;
  pressKey(args: { key: string; modifiers: KeyboardModifier[]; guard: NativeTargetGuard }): Promise<void>;
  hotkey(args: { keys: string[]; guard: NativeTargetGuard }): Promise<void>;
  getAccessibilityTree(args: { maxDepth: number; maxNodes: number; guard: NativeTargetGuard }): Promise<AccessibilityNode>;
  getFocusedElement(args: { guard: NativeTargetGuard }): Promise<AccessibilityNode | null>;
  shutdown?(): Promise<void>;
}

export type ComputerUseToolResult = ServerResult;
