#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import fetch from 'cross-fetch';

function printUsage() {
  console.log('Usage: npx lamdis-runs run-file <file> [--server URL]');
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    printUsage();
    process.exit(0);
  }

  if (cmd !== 'run-file') {
    printUsage();
    process.exit(1);
  }

  const filePath = args[1];
  if (!filePath) {
    printUsage();
    process.exit(1);
  }

  let server = process.env.LAMDIS_RUNS_URL || 'http://127.0.0.1:3101';
  const rest = args.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--server' && rest[i + 1]) {
      server = rest[i + 1];
      i++;
    }
  }

  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(1);
  }

  const token = process.env.LAMDIS_API_TOKEN || '';
  const body = {
    filePath: abs,
    cwd: process.cwd(),
  };

  const resp = await fetch(`${server.replace(/\/$/, '')}/internal/run-file`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-api-token': token } : {}),
    },
    body: JSON.stringify(body),
  });

  const txt = await resp.text();
  if (!resp.ok) {
    console.error('Run failed:', resp.status, txt);
    process.exit(1);
  }

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    console.log(txt);
    process.exit(0);
  }

  console.log(JSON.stringify(json, null, 2));

  const passed = Number(json?.totals?.passed || 0);
  const failed = Number(json?.totals?.failed || 0);
  if (failed > 0 || passed === 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err?.message || err);
  process.exit(1);
});
