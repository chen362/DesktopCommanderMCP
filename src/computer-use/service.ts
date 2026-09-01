import type { ServerResult } from '../types.js';
import { getComputerUseConfig, isComputerUsePlatformSupported } from './config.js';
import { ComputerUseError } from './errors.js';
import {
  assertApplicationAllowed,
  assertCapabilityEnabled,
  assertDisplayAllowed,
  assertHotkeyConfirmed,
  assertTerminalTextAllowed,
  normalizeHotkey,
  normalizeHotkeyKeys,
  validatePoint,
} from './policy.js';
import type {
  ComputerUseBackend,
  ComputerUseConfig,
  ComputerUseToolName,
  DisplayInfo,
  KeyboardModifier,
  Point,
  WindowInfo,
} from './types.js';
import { MacOSComputerUseBackend } from './macos/backend.js';

type ConfigProvider = () => Promise<ComputerUseConfig>;

function jsonResult(label: string, value: unknown, structuredContent?: Record<string, unknown>): ServerResult {
  return {
    content: [{ type: 'text', text: `${label}:\n${JSON.stringify(value, null, 2)}` }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function pointInsideWindow(point: Point, window: WindowInfo): boolean {
  return point.x >= window.x && point.y >= window.y
    && point.x < window.x + window.width && point.y < window.y + window.height;
}

export class ComputerUseService {
  private lastScreenshotTimestamp: string | null = null;

  constructor(
    private readonly backend: ComputerUseBackend,
    private readonly configProvider: ConfigProvider = getComputerUseConfig,
  ) {}

  private async requireInputPermission(): Promise<void> {
    const permissions = await this.backend.checkPermissions(false);
    if (!permissions.accessibility && !permissions.postEvents) {
      throw new ComputerUseError(
        'ACCESSIBILITY_PERMISSION_REQUIRED',
        'Accessibility permission is required. Open System Settings -> Privacy & Security -> Accessibility, enable the Desktop Commander Computer Use helper, then restart the Remote Device process.',
      );
    }
  }

  private async requireScreenPermission(): Promise<void> {
    const permissions = await this.backend.checkPermissions(false);
    if (!permissions.screenRecording) {
      throw new ComputerUseError(
        'SCREEN_RECORDING_PERMISSION_REQUIRED',
        'Screen Recording permission is required. Open System Settings -> Privacy & Security -> Screen & System Audio Recording, enable the Desktop Commander Computer Use helper, then restart the Remote Device process.',
      );
    }
  }

  private async validateCoordinates(points: Point[], config: ComputerUseConfig): Promise<DisplayInfo[]> {
    const displays = await this.backend.getScreenInfo();
    for (const point of points) validatePoint(displays, point, config.allowedDisplays);
    return displays;
  }

  private async assertActiveApplicationAllowed(config: ComputerUseConfig): Promise<WindowInfo | null> {
    const activeWindow = await this.backend.getActiveWindow();
    assertApplicationAllowed(activeWindow, config.allowedApps);
    return activeWindow;
  }

  private async assertPointApplicationAllowed(point: Point, config: ComputerUseConfig): Promise<void> {
    if (config.allowedApps.length === 0) return;
    const windows = await this.backend.getWindows({ onScreenOnly: true, limit: 200 });
    const target = windows.find((window) => pointInsideWindow(point, window)) ?? null;
    assertApplicationAllowed(target, config.allowedApps);
  }

  private filterDisplays(displays: DisplayInfo[], config: ComputerUseConfig): DisplayInfo[] {
    return config.allowedDisplays.length === 0
      ? displays
      : displays.filter((display) => config.allowedDisplays.includes(display.displayId));
  }

  async execute(toolName: ComputerUseToolName, args: Record<string, any>): Promise<ServerResult> {
    const config = await this.configProvider();
    assertCapabilityEnabled(toolName, config);

    switch (toolName) {
      case 'computer_check_permissions': {
        const permissions = await this.backend.checkPermissions(args.prompt);
        return jsonResult('Computer Use permissions', permissions, { permissions });
      }
      case 'computer_get_screen_info': {
        const displays = this.filterDisplays(await this.backend.getScreenInfo(), config);
        return jsonResult('Connected displays', displays, { displays });
      }
      case 'computer_screenshot': {
        await this.requireScreenPermission();
        if (args.displayId !== undefined) assertDisplayAllowed(args.displayId, config.allowedDisplays);
        const screenshot = await this.backend.screenshot({
          displayId: args.displayId,
          includeCursor: args.includeCursor,
        });
        assertDisplayAllowed(screenshot.display.displayId, config.allowedDisplays);
        this.lastScreenshotTimestamp = screenshot.capturedAt;
        const metadata = {
          capturedAt: screenshot.capturedAt,
          mimeType: screenshot.mimeType,
          pixelWidth: screenshot.pixelWidth,
          pixelHeight: screenshot.pixelHeight,
          display: screenshot.display,
          coordinateConversion: 'logicalX = display.x + pixelX / scaleFactor; logicalY = display.y + pixelY / scaleFactor',
        };
        return {
          content: [
            { type: 'text', text: `Screenshot metadata:\n${JSON.stringify(metadata, null, 2)}` },
            { type: 'image', data: screenshot.data, mimeType: screenshot.mimeType },
          ],
          structuredContent: metadata,
        };
      }
      case 'computer_get_windows': {
        const windows = await this.backend.getWindows({ onScreenOnly: args.onScreenOnly, limit: args.limit });
        if (config.allowedDisplays.length === 0) return jsonResult('Windows', windows, { windows });
        const displays = await this.backend.getScreenInfo();
        const allowedIndexes = new Set(displays
          .filter((display) => config.allowedDisplays.includes(display.displayId))
          .map((display) => display.index));
        const filtered = windows.filter((window) => window.screenIndex === null || allowedIndexes.has(window.screenIndex));
        return jsonResult('Windows', filtered, { windows: filtered });
      }
      case 'computer_get_active_window': {
        const window = await this.backend.getActiveWindow();
        return jsonResult('Active window', window, { activeWindow: window });
      }
      case 'computer_get_mouse_position': {
        const position = await this.backend.getMousePosition();
        return jsonResult('Mouse position', position, { mousePosition: position });
      }
      case 'computer_move_mouse': {
        await this.requireInputPermission();
        const point = { x: args.x, y: args.y };
        await this.validateCoordinates([point], config);
        await this.backend.moveMouse(point);
        return jsonResult('Mouse moved', point);
      }
      case 'computer_click':
      case 'computer_double_click':
      case 'computer_right_click': {
        await this.requireInputPermission();
        const point = { x: args.x, y: args.y };
        await this.validateCoordinates([point], config);
        await this.assertPointApplicationAllowed(point, config);
        const button = toolName === 'computer_right_click' ? 'right' : 'left';
        const clickCount = toolName === 'computer_double_click' ? 2 : 1;
        await this.backend.click(point, button, clickCount);
        return jsonResult('Mouse click completed', { ...point, button, clickCount });
      }
      case 'computer_mouse_down':
      case 'computer_mouse_up': {
        await this.requireInputPermission();
        const position = await this.backend.getMousePosition();
        await this.validateCoordinates([position], config);
        await this.assertPointApplicationAllowed(position, config);
        if (toolName === 'computer_mouse_down') await this.backend.mouseDown(args.button);
        else await this.backend.mouseUp(args.button);
        return jsonResult(toolName === 'computer_mouse_down' ? 'Mouse button pressed' : 'Mouse button released', {
          button: args.button,
          position,
        });
      }
      case 'computer_drag': {
        await this.requireInputPermission();
        const from = { x: args.fromX, y: args.fromY };
        const to = { x: args.toX, y: args.toY };
        await this.validateCoordinates([from, to], config);
        await this.assertPointApplicationAllowed(from, config);
        await this.assertPointApplicationAllowed(to, config);
        await this.backend.drag({ from, to, button: args.button, durationMs: args.durationMs });
        return jsonResult('Drag completed', { from, to, button: args.button, durationMs: args.durationMs });
      }
      case 'computer_scroll': {
        await this.requireInputPermission();
        await this.assertActiveApplicationAllowed(config);
        await this.backend.scroll({ deltaX: args.deltaX, deltaY: args.deltaY });
        return jsonResult('Scroll completed', { deltaX: args.deltaX, deltaY: args.deltaY });
      }
      case 'computer_type': {
        await this.requireInputPermission();
        const activeWindow = await this.assertActiveApplicationAllowed(config);
        assertTerminalTextAllowed(args.text, activeWindow, args.confirmed, config);
        await this.backend.typeText({ text: args.text, intervalMs: args.intervalMs });
        return jsonResult('Text typed', { characterCount: Array.from(args.text).length });
      }
      case 'computer_key': {
        await this.requireInputPermission();
        await this.assertActiveApplicationAllowed(config);
        const modifiers = args.modifiers as KeyboardModifier[];
        const normalized = normalizeHotkey(args.key, modifiers);
        assertHotkeyConfirmed(normalized, args.confirmed, config);
        await this.backend.pressKey({ key: args.key, modifiers });
        return jsonResult('Key pressed', { key: args.key, modifiers });
      }
      case 'computer_hotkey': {
        await this.requireInputPermission();
        await this.assertActiveApplicationAllowed(config);
        const normalized = normalizeHotkeyKeys(args.keys);
        assertHotkeyConfirmed(normalized, args.confirmed, config);
        await this.backend.hotkey({ keys: args.keys });
        return jsonResult('Hotkey pressed', { keys: args.keys });
      }
      case 'computer_get_state': {
        const displays = this.filterDisplays(await this.backend.getScreenInfo(), config);
        const mousePosition = await this.backend.getMousePosition();
        const activeWindow = await this.backend.getActiveWindow();
        const state = {
          timestamp: new Date().toISOString(),
          lastScreenshotTimestamp: this.lastScreenshotTimestamp,
          connectedDisplayCount: displays.length,
          displays,
          mousePosition,
          activeWindow,
        };
        return jsonResult('Computer Use state', state, state);
      }
      case 'computer_get_accessibility_tree': {
        const permissions = await this.backend.checkPermissions(false);
        if (!permissions.accessibility) {
          throw new ComputerUseError(
            'ACCESSIBILITY_PERMISSION_REQUIRED',
            'Accessibility permission is required to inspect UI elements. Open System Settings -> Privacy & Security -> Accessibility and enable the Desktop Commander Computer Use helper.',
          );
        }
        const tree = await this.backend.getAccessibilityTree({ maxDepth: args.maxDepth, maxNodes: args.maxNodes });
        return jsonResult('Accessibility tree', tree, { accessibilityTree: tree });
      }
      case 'computer_get_focused_element': {
        const permissions = await this.backend.checkPermissions(false);
        if (!permissions.accessibility) {
          throw new ComputerUseError(
            'ACCESSIBILITY_PERMISSION_REQUIRED',
            'Accessibility permission is required to inspect the focused UI element. Open System Settings -> Privacy & Security -> Accessibility and enable the Desktop Commander Computer Use helper.',
          );
        }
        const element = await this.backend.getFocusedElement();
        return jsonResult('Focused accessibility element', element, { focusedElement: element });
      }
    }
  }
}

let singleton: ComputerUseService | null = null;

export function getComputerUseService(): ComputerUseService {
  if (singleton) return singleton;
  if (!isComputerUsePlatformSupported()) {
    throw new ComputerUseError('UNSUPPORTED_PLATFORM', 'Computer Use is currently implemented only for macOS.');
  }
  singleton = new ComputerUseService(new MacOSComputerUseBackend(getComputerUseConfig));
  return singleton;
}
