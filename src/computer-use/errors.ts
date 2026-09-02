export type ComputerUseErrorCode =
  | 'COMPUTER_USE_DISABLED'
  | 'UNSUPPORTED_PLATFORM'
  | 'SCREEN_RECORDING_PERMISSION_REQUIRED'
  | 'ACCESSIBILITY_PERMISSION_REQUIRED'
  | 'POST_EVENT_PERMISSION_REQUIRED'
  | 'SCREENSHOT_DISABLED'
  | 'MOUSE_DISABLED'
  | 'KEYBOARD_DISABLED'
  | 'ACCESSIBILITY_DISABLED'
  | 'INVALID_COORDINATES'
  | 'DISPLAY_NOT_ALLOWED'
  | 'APPLICATION_NOT_ALLOWED'
  | 'TARGET_CHANGED'
  | 'INVALID_CONFIGURATION'
  | 'CONFIRMATION_REQUIRED'
  | 'HELPER_UNAVAILABLE'
  | 'HELPER_TIMEOUT'
  | 'NATIVE_OPERATION_FAILED';

export class ComputerUseError extends Error {
  constructor(
    public readonly code: ComputerUseErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ComputerUseError';
  }
}

export function asComputerUseError(error: unknown): ComputerUseError {
  if (error instanceof ComputerUseError) return error;
  return new ComputerUseError(
    'NATIVE_OPERATION_FAILED',
    error instanceof Error ? error.message : String(error),
  );
}
