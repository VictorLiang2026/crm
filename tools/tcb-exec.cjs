#!/usr/bin/env node
/*
 * tcb-exec.cjs — run ONE SQL statement via `tcb db execute` (PostgreSQL, service_role).
 *
 * Why: PowerShell 5.1 mangles embedded double quotes when passing native args
 * (c."Id" arrived as c.id), and multiline --sql values are silently dropped by
 * the CLI. Node's spawn escapes args correctly, so the SQL is passed through here.
 * Only the FIRST statement of a file is executed by the CLI — pass single-statement files.
 *
 * Usage:
 *   node tools/tcb-exec.cjs --file tools/pmc14-step2-update.sql [--env crm-...] [--role service_role]
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function parseArgs(argv) {
  const args = { env: 'crm-d1gkae8ddc930d151', role: 'service_role' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') args.file = argv[++i];
    else if (a === '--env') args.env = argv[++i];
    else if (a === '--role') args.role = argv[++i];
    else throw new Error('Unknown argument: ' + a);
  }
  if (!args.file) throw new Error('--file <path> is required');
  return args;
}

function resolveTcb() {
  // Spawn node + the CLI's JS entry directly (spawning .cmd is blocked since
  // Node CVE-2024-27980, and shell:true would reintroduce cmd.exe quoting issues).
  const p = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb');
  if (!fs.existsSync(p)) throw new Error('CloudBase CLI entry not found at ' + p);
  return p;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) throw new Error('File not found: ' + filePath);
  const sql = fs.readFileSync(filePath, 'utf8');
  const tcb = resolveTcb();
  const child = spawn(process.execPath, [tcb, 'db', 'execute', '-e', args.env, '--role', args.role, '--sql', sql, '--json'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { out += d.toString(); });
  const code = await new Promise(resolve => child.on('close', resolve));
  // Print only the JSON payload lines (skip CLI banner lines).
  const jsonLines = out.split('\n').filter(l => l.trim().startsWith('{') || l.trim().startsWith('['));
  if (jsonLines.length) {
    try {
      const parsed = JSON.parse(jsonLines.join('\n'));
      console.log(JSON.stringify(parsed, null, 2));
    } catch { console.log(out); }
  } else {
    console.log(out);
  }
  process.exit(code === 0 ? 0 : 1);
}

main().catch(e => { console.error('tcb-exec ERROR: ' + e.message); process.exit(1); });
