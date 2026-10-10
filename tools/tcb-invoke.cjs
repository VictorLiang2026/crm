#!/usr/bin/env node
/*
 * tcb-invoke.cjs — invoke a cloud function via tcb CLI (Node spawn to avoid PowerShell quoting).
 * Usage: node tools/tcb-invoke.cjs --fn <functionName> --params '<json>'
 */
'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');

function parseArgs(argv) {
  const args = { env: 'crm-d1gkae8ddc930d151', params: '{}' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fn') args.fn = argv[++i];
    else if (a === '--params') args.params = argv[++i];
    else if (a === '--env') args.env = argv[++i];
    else throw new Error('Unknown argument: ' + a);
  }
  if (!args.fn) throw new Error('--fn <functionName> is required');
  return args;
}

function resolveTcb() {
  const p = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb');
  if (!require('node:fs').existsSync(p)) throw new Error('CloudBase CLI entry not found at ' + p);
  return p;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tcb = resolveTcb();
  const child = spawn(process.execPath, [tcb, 'fn', 'invoke', args.fn, '--params', args.params, '--envId', args.env], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => stdout += d);
  child.stderr.on('data', d => stderr += d);
  return new Promise(resolve => {
    child.on('close', code => {
      console.log('exit code:', code);
      console.log('stdout:', stdout.slice(0, 3000));
      if (stderr) console.log('stderr:', stderr.slice(0, 2000));
      resolve();
    });
  });
}
main().catch(e => { console.error(e); process.exit(1); });
