#!/usr/bin/env node
/*
 * migration-apply.cjs — PMC-05+ 数据库 migration 执行工具
 *
 * 经本机 cloudbase-mcp queryPgDatabase 执行 migration SQL 文件（支持 DDL/DML/多语句）。
 * 与 pg-readonly.cjs 共用 MCP 通道，但不限制 SELECT/WITH。
 *
 * 安全约束：
 *   - 必须指定 --file <path>（不接受 --sql/--stdin，避免临时拼接）
 *   - 执行前打印文件哈希和大小，执行后打印返回结果
 *   - schema 限定 public（脚本内不解析 pr/pr_*，由调用方遵守）
 *   - 不接受 limit 参数（migration 不需要）
 *
 * Usage:
 *   node tools/migration-apply.cjs --file cloudbase/migrations/20261008120000_customers_person_id.sql
 *   node tools/migration-apply.cjs --file cloudbase/rollbacks/20261008120000_customers_person_id.sql --rollback
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function parseArgs(argv) {
  const args = { rollback: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') args.file = argv[++i];
    else if (a === '--rollback') args.rollback = true;
    else throw new Error('Unknown argument: ' + a);
  }
  if (!args.file) throw new Error('--file <path> is required');
  return args;
}

function resolveMcpCli() {
  if (process.env.CRM_CB_MCP_CLI) {
    if (!fs.existsSync(process.env.CRM_CB_MCP_CLI)) throw new Error('CRM_CB_MCP_CLI does not exist: ' + process.env.CRM_CB_MCP_CLI);
    return process.env.CRM_CB_MCP_CLI;
  }
  const bases = [
    path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx'),
    path.join(process.env.APPDATA || '', 'npm-cache', '_npx'),
  ].filter(Boolean);
  const candidates = [];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    for (const hash of fs.readdirSync(base)) {
      const p = path.join(base, hash, 'node_modules', '@cloudbase', 'cloudbase-mcp', 'dist', 'cli.cjs');
      if (fs.existsSync(p)) candidates.push(p);
    }
  }
  if (!candidates.length) throw new Error('cloudbase-mcp cli.cjs not found. Run `npx -y @cloudbase/cloudbase-mcp@latest` once or set CRM_CB_MCP_CLI.');
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

function runMigration(cli, sql) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [cli], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('MCP query timed out after 120s.')); }, 120000);
    p.stdout.on('data', (d) => {
      buf += d.toString();
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== 2) continue;
        clearTimeout(timer);
        p.kill();
        if (msg.error) return reject(new Error('MCP error: ' + JSON.stringify(msg.error)));
        const text = msg.result?.content?.map((c) => c.text || '').join('') || '';
        let parsed;
        try { parsed = JSON.parse(text); } catch { return reject(new Error('MCP returned non-JSON result: ' + text.slice(0, 500))); }
        if (parsed.success !== true) return reject(new Error('Migration failed: ' + (parsed.message || JSON.stringify(parsed).slice(0, 500))));
        return resolve(parsed.data);
      }
    });
    p.stderr.on('data', () => {});
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'crm-migration-apply', version: '1.0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'queryPgDatabase', arguments: { action: 'sql', sql, limit: 1 } } }), 800);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) throw new Error('File not found: ' + filePath);
  const sql = fs.readFileSync(filePath, 'utf8');
  const hash = crypto.createHash('sha256').update(sql).digest('hex').substring(0, 16);
  const size = sql.length;
  console.error('[migration-apply] file=' + filePath);
  console.error('[migration-apply] sha256=' + hash + ' size=' + size + ' mode=' + (args.rollback ? 'ROLLBACK' : 'APPLY'));
  const cli = resolveMcpCli();
  const data = await runMigration(cli, sql);
  console.log(JSON.stringify({ file: filePath, hash, size, mode: args.rollback ? 'ROLLBACK' : 'APPLY', result: data }, null, 2));
}

main().catch((e) => { console.error('migration-apply ERROR: ' + e.message); process.exit(1); });
