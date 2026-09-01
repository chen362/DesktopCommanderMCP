import { zodToJsonSchema } from 'zod-to-json-schema';
import { shouldExposeComputerUseTools } from './config.js';
import {
  ComputerCheckPermissionsArgsSchema,
  ComputerClickArgsSchema,
  ComputerDragArgsSchema,
  ComputerGetAccessibilityTreeArgsSchema,
  ComputerGetActiveWindowArgsSchema,
  ComputerGetFocusedElementArgsSchema,
  ComputerGetMousePositionArgsSchema,
  ComputerGetScreenInfoArgsSchema,
  ComputerGetStateArgsSchema,
  ComputerGetWindowsArgsSchema,
  ComputerHotkeyArgsSchema,
  ComputerKeyArgsSchema,
  ComputerMouseButtonArgsSchema,
  ComputerMoveMouseArgsSchema,
  ComputerScreenshotArgsSchema,
  ComputerScrollArgsSchema,
  ComputerTypeArgsSchema,
} from './schemas.js';

const COORDINATE_RULES = `Coordinates are logical points in the global Core Graphics display space: (0, 0) is the upper-left corner of the primary display, x increases right, and y increases down. Secondary displays may have negative origins. Retina screenshots contain physical pixels; convert screenshot pixels with logical = display origin + pixel / scaleFactor.`;

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const mutating = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export function buildComputerUseToolDefinitions() {
  return [
    {
      name: 'computer_check_permissions',
      description: 'Check macOS Screen Recording, Accessibility, and event-posting permissions for the persistent Computer Use helper. Set prompt=true only when the user wants macOS to open permission prompts. This tool does not change Desktop Commander configuration.',
      inputSchema: zodToJsonSchema(ComputerCheckPermissionsArgsSchema),
      annotations: { title: 'Check Computer Use Permissions', ...readOnly },
    },
    {
      name: 'computer_get_screen_info',
      description: `Return every connected display with display ID, global logical frame, visible frame, physical pixel dimensions, Retina scale factor, index, and primary status. ${COORDINATE_RULES}`,
      inputSchema: zodToJsonSchema(ComputerGetScreenInfoArgsSchema),
      annotations: { title: 'Get Screen Information', ...readOnly },
    },
    {
      name: 'computer_screenshot',
      description: `Capture one macOS display and return a real MCP image content block containing PNG bytes. The primary display is used when displayId is omitted. The accompanying metadata gives the capture timestamp, logical display frame, physical image size, and Retina scale factor. ${COORDINATE_RULES}`,
      inputSchema: zodToJsonSchema(ComputerScreenshotArgsSchema),
      annotations: { title: 'Capture Screen', ...readOnly },
    },
    {
      name: 'computer_get_windows',
      description: `List macOS windows with application name, bundle identifier, title, window ID, logical bounds, frontmost/active state, minimized/on-screen state, and display index. Bounds use the same global logical coordinate system as mouse tools. ${COORDINATE_RULES}`,
      inputSchema: zodToJsonSchema(ComputerGetWindowsArgsSchema),
      annotations: { title: 'List Windows', ...readOnly },
    },
    {
      name: 'computer_get_active_window',
      description: `Return the frontmost macOS application window and its logical bounds. Use this before typing or when an allowed-application policy is active. ${COORDINATE_RULES}`,
      inputSchema: zodToJsonSchema(ComputerGetActiveWindowArgsSchema),
      annotations: { title: 'Get Active Window', ...readOnly },
    },
    {
      name: 'computer_get_mouse_position',
      description: `Return the current pointer location in global logical screen coordinates. ${COORDINATE_RULES}`,
      inputSchema: zodToJsonSchema(ComputerGetMousePositionArgsSchema),
      annotations: { title: 'Get Mouse Position', ...readOnly },
    },
    {
      name: 'computer_move_mouse',
      description: `Move the macOS pointer to x,y without clicking. Coordinates are validated against the current display layout and allowedDisplays policy. ${COORDINATE_RULES}`,
      inputSchema: zodToJsonSchema(ComputerMoveMouseArgsSchema),
      annotations: { title: 'Move Mouse', ...mutating },
    },
    {
      name: 'computer_click',
      description: `Left-click the macOS screen at x,y. Use computer_screenshot or computer_get_screen_info first when the layout is unknown. Coordinates are validated before the event is posted. ${COORDINATE_RULES}`,
      inputSchema: zodToJsonSchema(ComputerClickArgsSchema),
      annotations: { title: 'Click', ...mutating },
    },
    {
      name: 'computer_double_click',
      description: `Double left-click the macOS screen at x,y using a Quartz click count of two. Coordinates are validated before events are posted. ${COORDINATE_RULES}`,
      inputSchema: zodToJsonSchema(ComputerClickArgsSchema),
      annotations: { title: 'Double Click', ...mutating },
    },
    {
      name: 'computer_right_click',
      description: `Right-click the macOS screen at x,y. Coordinates are validated before the event is posted. ${COORDINATE_RULES}`,
      inputSchema: zodToJsonSchema(ComputerClickArgsSchema),
      annotations: { title: 'Right Click', ...mutating },
    },
    {
      name: 'computer_mouse_down',
      description: 'Press and hold a mouse button at the current pointer position. Pair with computer_mouse_up; use computer_drag for ordinary drag gestures. The helper tracks the real pointer position and posts a native Quartz event.',
      inputSchema: zodToJsonSchema(ComputerMouseButtonArgsSchema),
      annotations: { title: 'Mouse Button Down', ...mutating },
    },
    {
      name: 'computer_mouse_up',
      description: 'Release a mouse button at the current pointer position. Use the same button value supplied to computer_mouse_down.',
      inputSchema: zodToJsonSchema(ComputerMouseButtonArgsSchema),
      annotations: { title: 'Mouse Button Up', ...mutating },
    },
    {
      name: 'computer_drag',
      description: `Drag from one validated global logical point to another over durationMs using native mouse-down, dragged, and mouse-up events. Both endpoints must be on connected and allowed displays. ${COORDINATE_RULES}`,
      inputSchema: zodToJsonSchema(ComputerDragArgsSchema),
      annotations: { title: 'Drag', ...mutating },
    },
    {
      name: 'computer_scroll',
      description: 'Scroll the active macOS application with native pixel scroll events. Positive deltaY scrolls up and negative deltaY scrolls down; positive deltaX scrolls left and negative deltaX scrolls right. Values are signed pixel deltas, not absolute coordinates.',
      inputSchema: zodToJsonSchema(ComputerScrollArgsSchema),
      annotations: { title: 'Scroll', ...mutating },
    },
    {
      name: 'computer_type',
      description: 'Type Unicode text into the focused macOS control using Quartz Unicode keyboard events. Supports Chinese, English, numbers, and symbols. The text is redacted from Desktop Commander audit logs. Dangerous terminal commands may require explicit user confirmation and confirmed=true.',
      inputSchema: zodToJsonSchema(ComputerTypeArgsSchema),
      annotations: { title: 'Type Text', ...mutating },
    },
    {
      name: 'computer_key',
      description: 'Press and release one key, optionally with command/control/option/shift/fn modifiers. Supported named keys include escape, enter, tab, backspace, delete, space, arrows, home, end, pageup, pagedown, F1-F12, letters, digits, and common punctuation. Closing or locking shortcuts require confirmed=true when policy protection is enabled.',
      inputSchema: zodToJsonSchema(ComputerKeyArgsSchema),
      annotations: { title: 'Press Key', ...mutating },
    },
    {
      name: 'computer_hotkey',
      description: 'Press a keyboard shortcut expressed as an array such as ["command", "space"] or ["command", "shift", "p"]. Include exactly one non-modifier key. Closing or locking shortcuts require explicit user confirmation and confirmed=true when policy protection is enabled.',
      inputSchema: zodToJsonSchema(ComputerHotkeyArgsSchema),
      annotations: { title: 'Press Hotkey', ...mutating },
    },
    {
      name: 'computer_get_state',
      description: 'Return a fresh Computer Use state snapshot: current timestamp, last screenshot timestamp, connected display count and layout, current pointer position, and active window. Screenshots themselves are never cached.',
      inputSchema: zodToJsonSchema(ComputerGetStateArgsSchema),
      annotations: { title: 'Get Computer State', ...readOnly },
    },
    {
      name: 'computer_get_accessibility_tree',
      description: 'Return a bounded macOS Accessibility tree for the frontmost application. Nodes can include role, title, value, description, position, size, enabled, focused, and children. Secure text-field values are redacted. maxDepth and maxNodes prevent unbounded traversal.',
      inputSchema: zodToJsonSchema(ComputerGetAccessibilityTreeArgsSchema),
      annotations: { title: 'Get Accessibility Tree', ...readOnly },
    },
    {
      name: 'computer_get_focused_element',
      description: 'Return the currently focused macOS Accessibility element with role, title, redacted-safe value, description, logical position and size, enabled state, and focus state. Requires Accessibility permission.',
      inputSchema: zodToJsonSchema(ComputerGetFocusedElementArgsSchema),
      annotations: { title: 'Get Focused UI Element', ...readOnly },
    },
  ];
}

export async function getComputerUseToolDefinitions() {
  return await shouldExposeComputerUseTools() ? buildComputerUseToolDefinitions() : [];
}
