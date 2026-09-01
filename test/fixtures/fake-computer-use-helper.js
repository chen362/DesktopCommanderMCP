#!/usr/bin/env node

import readline from 'node:readline';

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.action === 'hang') return;
  if (request.action === 'crash') process.exit(7);
  process.stdout.write(`${JSON.stringify({
    id: request.id,
    ok: true,
    result: { action: request.action, pid: process.pid },
  })}\n`);
});
