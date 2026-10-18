'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const cliRoot = path.join(process.env.APPDATA, 'npm/node_modules/@cloudbase/cli');
const manifest = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8'));
const cli = path.resolve(cliRoot, typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.tcb);
if (!cli.startsWith(path.resolve(cliRoot) + path.sep)) throw Error('Unexpected CloudBase CLI entry');
const sql = fs.readFileSync(path.join(__dirname, 'ai-audit-transaction.sql'), 'utf8');
if (/\bpr\.|\bpr_[a-z]/i.test(sql)) throw Error('SQL outside public CRM scope');
const child = spawn(process.execPath,
  [cli, 'db', 'execute', '-e', 'crm-d1gkae8ddc930d151', '--role', 'service_role',
    '--sql', sql, '--json'],
  { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => { output += chunk; if (output.length > 100000) child.kill(); });
child.stderr.on('data', chunk => { output += chunk; if (output.length > 100000) child.kill(); });
const timer = setTimeout(() => child.kill(), 45000);
child.on('error', error => { clearTimeout(timer); throw error; });
child.on('close', code => {
  clearTimeout(timer);
  if (code !== 0) throw Error(`PC33 AI audit SQL failed: ${output.slice(-1600)}`);
  const parsed = JSON.parse(output.slice(output.indexOf('{')));
  if (!output.includes('PC33_AI_AUDIT_11_PASS_ROLLED_BACK') || !parsed.data) {
    throw Error(`PC33 AI audit did not return expected receipt: ${output.slice(-800)}`);
  }
  process.stdout.write('PC33 AI audit: 11 checks passed; outer transaction rolled back\n');
});
