import type { ServerResult } from '../types.js';
import { ComputerUseError, asComputerUseError } from './errors.js';
import { isComputerUseToolName } from './logging.js';
import { computerUseToolArgSchemas } from './schemas.js';
import { getComputerUseService } from './service.js';

export async function handleComputerUseTool(name: string, args: unknown): Promise<ServerResult> {
  if (!isComputerUseToolName(name)) {
    throw new ComputerUseError('NATIVE_OPERATION_FAILED', `Unknown Computer Use tool: ${name}`);
  }
  const schema = computerUseToolArgSchemas[name];
  const parsed = schema.parse(args ?? {});
  try {
    return await getComputerUseService().execute(name, parsed as Record<string, any>);
  } catch (error) {
    const computerError = asComputerUseError(error);
    throw new Error(`${computerError.code}: ${computerError.message}`);
  }
}
