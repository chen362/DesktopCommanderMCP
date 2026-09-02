import type { ServerResult } from '../types.js';
import { getComputerUseConfig, isComputerUsePlatformSupported } from './config.js';
import { ComputerUseError } from './errors.js';
import {
  assertApplicationAllowed,
  assertCapabilityEnabled,
  assertDisplayAllowed,
  assertHotkeyConfirmed,
  assertTerminalTextAllowed,
  isApplicationAllowed,
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
  NativeTargetGuard,
  Point,
  Rect,
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

function pointInsideRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.y >= rect.y
    && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

export class ComputerUseService {
  private lastScreenshotTimestamp: string | null = null;

  constructor(
    private readonly backend: ComputerUseBackend,
    private readonly configProvider: ConfigProvider = getComputerUseConfig,
  ) {}

  private async requireInputPermission(): Promise<void> {
    const permissions = await this.backend.checkPermissions(false);
    if (!permissions.postEvents) {
      throw new ComputerUseError(
        'POST_EVENT_PERMISSION_REQUIRED',
        'Post Events permission is required for mouse and keyboard input. Open System Settings -> Privacy & Security -> Accessibility, enable the Desktop Commander Computer Use helper, then restart the client process that runs Desktop Commander.',
      );
    }
  }

  private async requireScreenPermission(): Promise<void> {
    const permissions = await this.backend.checkPermissions(false);
    if (!permissions.screenRecording) {
      throw new ComputerUseError(
        'SCREEN_RECORDING_PERMISSION_REQUIRED',
        'Screen Recording permission is required. Open System Settings -> Privacy & Security -> Screen & System Audio Recording, enable the Desktop Commander Computer Use helper, then restart the client process that runs Desktop Commander.',
      );
    }
  }

  private async validateCoordinates(points: Point[], config: ComputerUseConfig): Promise<DisplayInfo[]> {
    const displays = await this.backend.getScreenInfo();
    for (const point of points) validatePoint(displays, point, config.allowedDisplays);
    return displays;
  }

  private windowUsesAllowedDisplay(
    window: WindowInfo | null,
    displays: DisplayInfo[],
    allowedDisplays: number[],
  ): boolean {
    if (allowedDisplays.length === 0) return true;
    if (!window) return false;
    if (typeof window.displayId === 'number') return allowedDisplays.includes(window.displayId);
    if (window.screenIndex === null) return false;
    const display = displays.find((candidate) => candidate.index === window.screenIndex);
    return !!display && allowedDisplays.includes(display.displayId);
  }

  private async assertActiveTargetAllowed(config: ComputerUseConfig): Promise<WindowInfo | null> {
    const activeWindow = await this.backend.getActiveWindow();
    assertApplicationAllowed(activeWindow, config.allowedApps);
    if (config.allowedDisplays.length > 0) {
      const displays = await this.backend.getScreenInfo();
      if (!this.windowUsesAllowedDisplay(activeWindow, displays, config.allowedDisplays)) {
        throw new ComputerUseError(
          'DISPLAY_NOT_ALLOWED',
          'The active window is not on a display allowed by the Computer Use policy.',
        );
      }
    }
    return activeWindow;
  }

  private async pointTarget(point: Point, config: ComputerUseConfig): Promise<WindowInfo | null> {
    const windows = await this.backend.getWindows({ onScreenOnly: true, limit: 200 });
    const target = windows.find((window) => pointInsideRect(point, window)) ?? null;
    assertApplicationAllowed(target, config.allowedApps);
    return target;
  }

  private targetGuard(
    config: ComputerUseConfig,
    expected: Omit<NativeTargetGuard, 'allowedDisplayIds'> = {},
  ): NativeTargetGuard {
    return {
      allowedDisplayIds: config.allowedDisplays,
      ...expected,
    };
  }

  private filterDisplays(displays: DisplayInfo[], config: ComputerUseConfig): DisplayInfo[] {
    return config.allowedDisplays.length === 0
      ? displays
      : displays.filter((display) => config.allowedDisplays.includes(display.displayId));
  }

  private filterWindows(
    windows: WindowInfo[],
    displays: DisplayInfo[],
    config: ComputerUseConfig,
  ): WindowInfo[] {
    return windows.filter((window) => isApplicationAllowed(window, config.allowedApps)
      && this.windowUsesAllowedDisplay(window, displays, config.allowedDisplays));
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
        let displayId = args.displayId as number | undefined;
        if (config.allowedDisplays.length > 0) {
          const displays = await this.backend.getScreenInfo();
          if (displayId === undefined) {
            const allowed = displays.filter((display) => config.allowedDisplays.includes(display.displayId));
            const selected = allowed.find((display) => display.primary) ?? allowed[0];
            if (!selected) {
              throw new ComputerUseError(
                'DISPLAY_NOT_ALLOWED',
                'None of the displays allowed by the Computer Use policy are currently connected.',
              );
            }
            displayId = selected.displayId;
          } else {
            assertDisplayAllowed(displayId, config.allowedDisplays);
          }
        }
        const screenshot = await this.backend.screenshot({
          displayId,
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
          coordinateConversion: 'logical x = display x + pixel x / scale factor; logical y = display y + pixel y / scale factor',
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
        const policyFiltersWindows = config.allowedApps.length > 0 || config.allowedDisplays.length > 0;
        const windows = await this.backend.getWindows({
          onScreenOnly: args.onScreenOnly,
          limit: policyFiltersWindows ? 500 : args.limit,
        });
        const displays = config.allowedDisplays.length > 0 ? await this.backend.getScreenInfo() : [];
        const filtered = this.filterWindows(windows, displays, config).slice(0, args.limit);
        return jsonResult('Windows', filtered, { windows: filtered });
      }
      case 'computer_get_active_window': {
        const window = await this.backend.getActiveWindow();
        const displays = config.allowedDisplays.length > 0 ? await this.backend.getScreenInfo() : [];
        const filtered = isApplicationAllowed(window, config.allowedApps)
          && this.windowUsesAllowedDisplay(window, displays, config.allowedDisplays)
          ? window
          : null;
        return jsonResult('Active window', filtered, { activeWindow: filtered });
      }
      case 'computer_get_mouse_position': {
        const position = await this.backend.getMousePosition();
        if (config.allowedDisplays.length > 0) await this.validateCoordinates([position], config);
        return jsonResult('Mouse position', position, { mousePosition: position });
      }
      case 'computer_move_mouse': {
        await this.requireInputPermission();
        const point = { x: args.x, y: args.y };
        await this.validateCoordinates([point], config);
        await this.backend.moveMouse(point, this.targetGuard(config));
        return jsonResult('Mouse moved', point);
      }
      case 'computer_click':
      case 'computer_double_click':
      case 'computer_right_click': {
        await this.requireInputPermission();
        const point = { x: args.x, y: args.y };
        await this.validateCoordinates([point], config);
        const target = await this.pointTarget(point, config);
        const button = toolName === 'computer_right_click' ? 'right' : 'left';
        const clickCount = toolName === 'computer_double_click' ? 2 : 1;
        await this.backend.click(point, button, clickCount, this.targetGuard(config, {
          expectedProcessId: target?.processId,
          expectedWindowId: target?.windowId ?? undefined,
        }));
        return jsonResult('Mouse click completed', { ...point, button, clickCount });
      }
      case 'computer_mouse_down': {
        await this.requireInputPermission();
        const position = await this.backend.getMousePosition();
        await this.validateCoordinates([position], config);
        const target = await this.pointTarget(position, config);
        await this.backend.mouseDown(args.button, this.targetGuard(config, {
          expectedProcessId: target?.processId,
          expectedWindowId: target?.windowId ?? undefined,
        }));
        return jsonResult('Mouse button pressed', {
          button: args.button,
          position,
        });
      }
      case 'computer_mouse_up': {
        await this.requireInputPermission();
        const position = await this.backend.getMousePosition();
        await this.backend.mouseUp(args.button);
        return jsonResult('Mouse button released', { button: args.button, position });
      }
      case 'computer_drag': {
        await this.requireInputPermission();
        const from = { x: args.fromX, y: args.fromY };
        const to = { x: args.toX, y: args.toY };
        await this.validateCoordinates([from, to], config);
        const fromTarget = await this.pointTarget(from, config);
        const toTarget = await this.pointTarget(to, config);
        await this.backend.drag({
          from,
          to,
          button: args.button,
          durationMs: args.durationMs,
          guard: this.targetGuard(config, {
            expectedProcessId: fromTarget?.processId,
            expectedWindowId: fromTarget?.windowId ?? undefined,
            expectedDestinationProcessId: toTarget?.processId,
            expectedDestinationWindowId: toTarget?.windowId ?? undefined,
          }),
        });
        return jsonResult('Drag completed', { from, to, button: args.button, durationMs: args.durationMs });
      }
      case 'computer_scroll': {
        await this.requireInputPermission();
        const activeWindow = await this.assertActiveTargetAllowed(config);
        await this.backend.scroll({
          deltaX: args.deltaX,
          deltaY: args.deltaY,
          guard: this.targetGuard(config, {
            expectedProcessId: activeWindow?.processId,
            expectedWindowId: activeWindow?.windowId ?? undefined,
          }),
        });
        return jsonResult('Scroll completed', { deltaX: args.deltaX, deltaY: args.deltaY });
      }
      case 'computer_type': {
        await this.requireInputPermission();
        const activeWindow = await this.assertActiveTargetAllowed(config);
        assertTerminalTextAllowed(args.text, activeWindow, args.confirmed, config);
        await this.backend.typeText({
          text: args.text,
          intervalMs: args.intervalMs,
          guard: this.targetGuard(config, {
            expectedProcessId: activeWindow?.processId,
            expectedWindowId: activeWindow?.windowId ?? undefined,
          }),
        });
        return jsonResult('Text typed', { characterCount: Array.from(args.text).length });
      }
      case 'computer_key': {
        await this.requireInputPermission();
        const activeWindow = await this.assertActiveTargetAllowed(config);
        const modifiers = args.modifiers as KeyboardModifier[];
        const normalized = normalizeHotkey(args.key, modifiers);
        assertHotkeyConfirmed(normalized, args.confirmed, config);
        await this.backend.pressKey({
          key: args.key,
          modifiers,
          guard: this.targetGuard(config, {
            expectedProcessId: activeWindow?.processId,
            expectedWindowId: activeWindow?.windowId ?? undefined,
          }),
        });
        return jsonResult('Key pressed', { key: args.key, modifiers });
      }
      case 'computer_hotkey': {
        await this.requireInputPermission();
        const activeWindow = await this.assertActiveTargetAllowed(config);
        const keys = (args.keys as string[]).map((key) => key.trim()).map((key) =>
          ['command', 'control', 'option', 'shift', 'fn'].includes(key.toLowerCase()) ? key.toLowerCase() : key);
        const normalized = normalizeHotkeyKeys(keys);
        assertHotkeyConfirmed(normalized, args.confirmed, config);
        await this.backend.hotkey({
          keys,
          guard: this.targetGuard(config, {
            expectedProcessId: activeWindow?.processId,
            expectedWindowId: activeWindow?.windowId ?? undefined,
          }),
        });
        return jsonResult('Hotkey pressed', { keys });
      }
      case 'computer_get_state': {
        const allDisplays = await this.backend.getScreenInfo();
        const displays = this.filterDisplays(allDisplays, config);
        const rawMousePosition = await this.backend.getMousePosition();
        const mousePosition = config.allowedDisplays.length === 0
          || displays.some((display) => pointInsideRect(rawMousePosition, display))
          ? rawMousePosition
          : null;
        const rawActiveWindow = await this.backend.getActiveWindow();
        const activeWindow = isApplicationAllowed(rawActiveWindow, config.allowedApps)
          && this.windowUsesAllowedDisplay(rawActiveWindow, allDisplays, config.allowedDisplays)
          ? rawActiveWindow
          : null;
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
        const activeWindow = await this.assertActiveTargetAllowed(config);
        const tree = await this.backend.getAccessibilityTree({
          maxDepth: args.maxDepth,
          maxNodes: args.maxNodes,
          guard: this.targetGuard(config, {
            expectedProcessId: activeWindow?.processId,
            expectedWindowId: activeWindow?.windowId ?? undefined,
          }),
        });
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
        const activeWindow = await this.assertActiveTargetAllowed(config);
        const element = await this.backend.getFocusedElement({
          guard: this.targetGuard(config, {
            expectedProcessId: activeWindow?.processId,
            expectedWindowId: activeWindow?.windowId ?? undefined,
          }),
        });
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
