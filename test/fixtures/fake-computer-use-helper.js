#!/usr/bin/env node

import readline from 'node:readline';

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let responseQueue = Promise.resolve();

input.on('line', (line) => {
  const request = JSON.parse(line);
  responseQueue = responseQueue.then(async () => {
    if (request.action === 'hang') await new Promise(() => {});
    if (request.action === 'crash') process.exit(7);
    const delayMs = Number(request.params?.delayMs || 0);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    process.stdout.write(`${JSON.stringify({
      id: request.id,
      ok: true,
      result: { action: request.action, pid: process.pid },
    })}\n`);
  });
});
