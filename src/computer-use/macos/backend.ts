import type {
  AccessibilityNode,
  ComputerUseBackend,
  ComputerUseConfig,
  DisplayInfo,
  KeyboardModifier,
  MouseButton,
  PermissionInfo,
  Point,
  ScreenshotResult,
  WindowInfo,
} from '../types.js';
import { MacOSHelperProcess } from './helper-process.js';

export class MacOSComputerUseBackend implements ComputerUseBackend {
  private readonly helper: MacOSHelperProcess;

  constructor(configProvider: () => Promise<ComputerUseConfig>) {
    this.helper = new MacOSHelperProcess(configProvider);
  }

  checkPermissions(prompt = false): Promise<PermissionInfo> {
    return this.helper.request('checkPermissions', { prompt });
  }

  getScreenInfo(): Promise<DisplayInfo[]> {
    return this.helper.request('screenInfo');
  }

  screenshot(args: { displayId?: number; includeCursor?: boolean }): Promise<ScreenshotResult> {
    return this.helper.request('screenshot', args);
  }

  getWindows(args: { onScreenOnly?: boolean; limit?: number }): Promise<WindowInfo[]> {
    return this.helper.request('windows', args);
  }

  getActiveWindow(): Promise<WindowInfo | null> {
    return this.helper.request('activeWindow');
  }

  getMousePosition(): Promise<Point> {
    return this.helper.request('mousePosition');
  }

  moveMouse(point: Point): Promise<void> {
    return this.helper.request('moveMouse', point);
  }

  click(point: Point, button: MouseButton, clickCount: 1 | 2): Promise<void> {
    return this.helper.request('click', { ...point, button, clickCount });
  }

  mouseDown(button: MouseButton): Promise<void> {
    return this.helper.request('mouseDown', { button });
  }

  mouseUp(button: MouseButton): Promise<void> {
    return this.helper.request('mouseUp', { button });
  }

  drag(args: { from: Point; to: Point; button: MouseButton; durationMs: number }): Promise<void> {
    return this.helper.request('drag', args);
  }

  scroll(args: { deltaX: number; deltaY: number }): Promise<void> {
    return this.helper.request('scroll', args);
  }

  typeText(args: { text: string; intervalMs: number }): Promise<void> {
    return this.helper.request('typeText', args);
  }

  pressKey(args: { key: string; modifiers: KeyboardModifier[] }): Promise<void> {
    return this.helper.request('key', args);
  }

  hotkey(args: { keys: string[] }): Promise<void> {
    return this.helper.request('hotkey', args);
  }

  getAccessibilityTree(args: { maxDepth: number; maxNodes: number }): Promise<AccessibilityNode> {
    return this.helper.request('accessibilityTree', args);
  }

  getFocusedElement(): Promise<AccessibilityNode | null> {
    return this.helper.request('focusedElement');
  }

  shutdown(): Promise<void> {
    return this.helper.shutdown();
  }
}
