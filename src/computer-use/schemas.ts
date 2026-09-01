import { z } from 'zod';

const coordinate = z.number().finite();
const MouseButtonSchema = z.enum(['left', 'right', 'middle']);
const KeyboardModifierSchema = z.enum(['command', 'control', 'option', 'shift', 'fn']);

export const ComputerUseConfigValueSchema = z.object({
  enabled: z.boolean().optional(),
  allowScreenshots: z.boolean().optional(),
  allowMouse: z.boolean().optional(),
  allowKeyboard: z.boolean().optional(),
  allowAccessibility: z.boolean().optional(),
  allowedDisplays: z.array(z.number().int().nonnegative()).optional(),
  allowedApps: z.array(z.string().min(1)).optional(),
  requireConfirmationForDangerousKeys: z.boolean().optional(),
  blockDangerousTerminalText: z.boolean().optional(),
  helperPath: z.string().min(1).optional(),
  requestTimeoutMs: z.number().int().min(100).max(120_000).optional(),
  screenshotTimeoutMs: z.number().int().min(100).max(120_000).optional(),
}).strict();

export const ComputerCheckPermissionsArgsSchema = z.object({
  prompt: z.boolean().optional().default(false),
});

export const ComputerGetScreenInfoArgsSchema = z.object({});

export const ComputerScreenshotArgsSchema = z.object({
  displayId: z.number().int().nonnegative().optional(),
  includeCursor: z.boolean().optional().default(true),
});

export const ComputerGetWindowsArgsSchema = z.object({
  onScreenOnly: z.boolean().optional().default(true),
  limit: z.number().int().min(1).max(500).optional().default(100),
});

export const ComputerGetActiveWindowArgsSchema = z.object({});
export const ComputerGetMousePositionArgsSchema = z.object({});

export const ComputerMoveMouseArgsSchema = z.object({
  x: coordinate,
  y: coordinate,
});

export const ComputerClickArgsSchema = z.object({
  x: coordinate,
  y: coordinate,
});

export const ComputerMouseButtonArgsSchema = z.object({
  button: MouseButtonSchema.optional().default('left'),
});

export const ComputerDragArgsSchema = z.object({
  fromX: coordinate,
  fromY: coordinate,
  toX: coordinate,
  toY: coordinate,
  button: MouseButtonSchema.optional().default('left'),
  durationMs: z.number().int().min(0).max(10_000).optional().default(500),
});

export const ComputerScrollArgsSchema = z.object({
  deltaX: z.number().int().min(-100_000).max(100_000).optional().default(0),
  deltaY: z.number().int().min(-100_000).max(100_000),
}).refine((value) => value.deltaX !== 0 || value.deltaY !== 0, {
  message: 'At least one scroll delta must be non-zero',
});

export const ComputerTypeArgsSchema = z.object({
  text: z.string().max(100_000),
  intervalMs: z.number().int().min(0).max(1_000).optional().default(0),
  confirmed: z.boolean().optional().default(false),
});

export const ComputerKeyArgsSchema = z.object({
  key: z.string().min(1).max(32),
  modifiers: z.array(KeyboardModifierSchema).max(5).optional().default([]),
  confirmed: z.boolean().optional().default(false),
});

export const ComputerHotkeyArgsSchema = z.object({
  keys: z.array(z.string().min(1).max(32)).min(2).max(6),
  confirmed: z.boolean().optional().default(false),
}).refine((value) => value.keys.filter((key) =>
  !['command', 'control', 'option', 'shift', 'fn'].includes(key.trim().toLowerCase())).length === 1, {
  message: 'A hotkey must contain exactly one non-modifier key',
});

export const ComputerGetStateArgsSchema = z.object({});

export const ComputerGetAccessibilityTreeArgsSchema = z.object({
  maxDepth: z.number().int().min(0).max(8).optional().default(3),
  maxNodes: z.number().int().min(1).max(1_000).optional().default(200),
});

export const ComputerGetFocusedElementArgsSchema = z.object({});

export const computerUseToolArgSchemas: Record<string, z.ZodTypeAny> = {
  computer_check_permissions: ComputerCheckPermissionsArgsSchema,
  computer_get_screen_info: ComputerGetScreenInfoArgsSchema,
  computer_screenshot: ComputerScreenshotArgsSchema,
  computer_get_windows: ComputerGetWindowsArgsSchema,
  computer_get_active_window: ComputerGetActiveWindowArgsSchema,
  computer_get_mouse_position: ComputerGetMousePositionArgsSchema,
  computer_move_mouse: ComputerMoveMouseArgsSchema,
  computer_click: ComputerClickArgsSchema,
  computer_double_click: ComputerClickArgsSchema,
  computer_right_click: ComputerClickArgsSchema,
  computer_mouse_down: ComputerMouseButtonArgsSchema,
  computer_mouse_up: ComputerMouseButtonArgsSchema,
  computer_drag: ComputerDragArgsSchema,
  computer_scroll: ComputerScrollArgsSchema,
  computer_type: ComputerTypeArgsSchema,
  computer_key: ComputerKeyArgsSchema,
  computer_hotkey: ComputerHotkeyArgsSchema,
  computer_get_state: ComputerGetStateArgsSchema,
  computer_get_accessibility_tree: ComputerGetAccessibilityTreeArgsSchema,
  computer_get_focused_element: ComputerGetFocusedElementArgsSchema,
};
