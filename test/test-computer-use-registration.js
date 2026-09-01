#!/usr/bin/env node

if (process.platform !== 'darwin') {
  console.log('SKIP Computer Use MCP registration test: tools are intentionally hidden on non-macOS hosts.');
  process.exit(0);
}

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport, getDefaultEnvironment } = await import('@modelcontextprotocol/sdk/client/stdio.js');

const expected = [
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
];

const client = new Client({ name: 'computer-use-registration-test', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['../dist/index.js', '--no-onboarding'],
  env: {
    ...getDefaultEnvironment(),
    COMPUTER_USE_ENABLED: 'true',
    DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1',
  },
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = new Set(listed.tools.map((tool) => tool.name));
  for (const name of expected) {
    if (!names.has(name)) throw new Error(`Missing Computer Use tool: ${name}`);
  }
  const permissions = await client.callTool({ name: 'computer_check_permissions', arguments: { prompt: false } });
  if (permissions.isError) throw new Error('computer_check_permissions returned an MCP error');
  console.log(`Computer Use MCP registration test passed (${expected.length} tools).`);
} finally {
  await client.close();
}
