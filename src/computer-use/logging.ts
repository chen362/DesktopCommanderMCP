import type { ServerResult } from '../types.js';
import { COMPUTER_USE_TOOL_NAMES, type ComputerUseToolName } from './types.js';

const COMPUTER_TOOL_SET = new Set<string>(COMPUTER_USE_TOOL_NAMES);

export function isComputerUseToolName(name: string): name is ComputerUseToolName {
  return COMPUTER_TOOL_SET.has(name);
}

export function sanitizeComputerUseArguments(toolName: string, args: unknown): unknown {
  if (!isComputerUseToolName(toolName) || !args || typeof args !== 'object') return args;
  const copy = { ...(args as Record<string, unknown>) };
  if (toolName === 'computer_type' && typeof copy.text === 'string') {
    copy.textLength = Array.from(copy.text).length;
    copy.text = '[REDACTED]';
  }
  return copy;
}

export function sanitizeComputerUseResultForLogs(toolName: string, result: ServerResult): ServerResult {
  if (!isComputerUseToolName(toolName)) return result;

  return {
    ...result,
    content: (result.content ?? []).map((item) => {
      if (item.type === 'image') {
        return {
          type: 'text',
          text: `[image omitted from audit log: ${item.mimeType ?? 'unknown'}, ${item.data?.length ?? 0} base64 characters]`,
        };
      }
      if ((toolName === 'computer_get_accessibility_tree' || toolName === 'computer_get_focused_element')
        && item.type === 'text') {
        return { type: 'text', text: '[accessibility result omitted from audit log]' };
      }
      return item;
    }),
    structuredContent: undefined,
  };
}

export function summarizeComputerUseResultForConsole(toolName: string, result: unknown): unknown {
  if (!isComputerUseToolName(toolName) || !result || typeof result !== 'object') return result;
  const record = result as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : [];
  return {
    isError: record.isError === true,
    content: content.map((item) => {
      if (!item || typeof item !== 'object') return { type: 'unknown' };
      const block = item as Record<string, unknown>;
      if (block.type === 'image') {
        return {
          type: 'image',
          mimeType: block.mimeType,
          dataLength: typeof block.data === 'string' ? block.data.length : 0,
        };
      }
      return {
        type: block.type,
        textLength: typeof block.text === 'string' ? block.text.length : 0,
      };
    }),
  };
}
