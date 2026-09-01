#!/usr/bin/env node

import { DesktopCommanderIntegration } from '../dist/remote-device/desktop-commander-integration.js';
import { RemoteChannel } from '../dist/remote-device/remote-channel.js';
import { summarizeComputerUseResultForConsole } from '../dist/computer-use/logging.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const imageResult = {
  content: [
    { type: 'text', text: 'capture metadata' },
    { type: 'image', data: 'iVBORw0KGgoREMOTEIMAGE', mimeType: 'image/png' },
  ],
};

const integration = new DesktopCommanderIntegration();
let forwardedRequest;
integration.isReady = true;
integration.mcpClient = {
  callTool: async (request) => {
    forwardedRequest = request;
    return imageResult;
  },
};

const forwardedResult = await integration.callClientTool('computer_screenshot', { includeCursor: true }, {
  clientInfo: { name: 'openai-mcp', version: 'test' },
});
assert(forwardedRequest._meta.remote === true, 'remote marker was not added');
assert(forwardedResult.content[1].type === 'image', 'image content type was flattened');
assert(forwardedResult.content[1].data === imageResult.content[1].data, 'image bytes changed on the local MCP bridge');

const channel = new RemoteChannel();
let storedPayload;
const updateChain = {
  update(payload) { storedPayload = payload; return this; },
  eq() { return Promise.resolve({ error: null }); },
};
channel.client = { from: () => updateChain };
await channel.updateCallResult('call-image', 'completed', forwardedResult);
assert(storedPayload.result.content[1].type === 'image', 'image type changed in Remote Channel storage');
assert(storedPayload.result.content[1].data === imageResult.content[1].data, 'image bytes changed in Remote Channel storage');

const summary = summarizeComputerUseResultForConsole('computer_screenshot', forwardedResult);
assert(!JSON.stringify(summary).includes(imageResult.content[1].data), 'remote console summary leaked screenshot base64');

console.log('Computer Use Remote MCP image transport test passed.');
