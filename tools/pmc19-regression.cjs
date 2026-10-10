#!/usr/bin/env node
/*
 * pmc19-regression.cjs — invoke key cloud functions for PMC-19 regression.
 * Embeds params to avoid PowerShell JSON quoting issues.
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ENV = 'crm-d1gkae8ddc930d151';
const tcb = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb');

function invoke(fn, params) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [tcb, 'fn', 'invoke', fn, '--params', JSON.stringify(params), '--envId', ENV], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', code => {
      resolve({ fn, code, out: out.slice(0, 1500), err: err.slice(0, 800) });
    });
  });
}

async function main() {
  const tests = [
    { fn: 'customers', params: { action: 'list', limit: 1 } },
    { fn: 'recruit_candidates', params: { action: 'list', limit: 1 } },
    { fn: 'recruit_candidates', params: { action: 'trashList' } },
  ];
  for (const t of tests) {
    const r = await invoke(t.fn, t.params);
    console.log('---');
    console.log('FN:', r.fn, '| exit:', r.code);
    console.log('OUT:', r.out);
    if (r.err) console.log('ERR:', r.err);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
