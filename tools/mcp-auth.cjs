#!/usr/bin/env node
/* 临时 cloudbase-mcp auth 工具 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 查找 cloudbase-mcp
const bases = [
  path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx'),
  path.join(process.env.APPDATA || '', 'npm-cache', '_npx'),
].filter(Boolean);

let cliPath = null;
for (const base of bases) {
  if (!fs.existsSync(base)) continue;
  for (const hash of fs.readdirSync(base)) {
    const p = path.join(base, hash, 'node_modules', '@cloudbase', 'cloudbase-mcp', 'dist', 'cli.cjs');
    if (fs.existsSync(p)) {
      cliPath = p;
      break;
    }
  }
  if (cliPath) break;
}

if (!cliPath) {
  console.error('cloudbase-mcp not found');
  process.exit(1);
}

console.log('Found cloudbase-mcp:', cliPath);
console.log('Starting auth flow...');
console.log('---');

const p = spawn('node', [cliPath], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
let authDone = false;

p.stdout.on('data', (d) => {
  buf += d.toString();
  for (const line of buf.split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        console.log('[INIT] OK');
      }
      if (msg.id === 2) {
        console.log('[AUTH] Response received:');
        console.log(JSON.stringify(msg, null, 2));
        authDone = true;
        p.kill();
      }
    } catch {}
  }
});

p.stderr.on('data', (d) => { process.stderr.write(d); });
p.on('error', (e) => { console.error(e); process.exit(1); });

const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'crm-auth', version: '1.0' } } });
send({ jsonrpc: '2.0', method: 'notifications/initialized' });

setTimeout(() => {
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'auth', arguments: { action: 'status' } } });
}, 800);

setTimeout(() => {
  if (!authDone) {
    console.error('[AUTH] Timeout after 120s');
    console.log('[AUTH] If auth failed, please manually run: npx -y @cloudbase/cloudbase-mcp@latest');
    p.kill();
    process.exit(1);
  }
}, 120000);
