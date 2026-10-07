#!/usr/bin/env node
/*
 * pg-readonly.cjs — shared read-only PostgreSQL query helper for Trae and Codex (PMC G3).
 *
 * Runs a single read-only SQL statement against the CRM production environment through the
 * locally installed CloudBase MCP server (queryPgDatabase), without registering new tools or
 * changing credentials. The MCP login/env binding is the same one used by `tcb` and the WP
 * security evidence collection.
 *
 * Usage:
 *   node tools/pg-readonly.cjs --file tests/wp01/catalog.sql [--limit 200]
 *   node tools/pg-readonly.cjs --sql "SELECT count(*)::int AS n FROM public.persons"
 *   echo "SELECT ..." | node tools/pg-readonly.cjs --stdin
 *   # Snapshot probes (catalog.sql / audit.sql return one JSON column "snapshot"):
 *   node tools/pg-readonly.cjs --file tests/wp04/audit.sql --snapshot --out tests/security/.results/wp04-audit.json
 *
 * Output modes:
 *   default  -> { columns, rows, returnedRows, truncated } JSON to stdout
 *   --snapshot -> parse and print rows[0].snapshot (the probe's JSON payload)
 *   --out FILE -> write the chosen output to FILE (utf8, no BOM) instead of stdout
 *
 * Safety:
 *   - Only one statement; it must start with WITH or SELECT (after comment/whitespace stripping).
 *   - DDL / DML / multi-statement input is rejected client-side and never sent.
 *   - The tool is read-only by construction; it is NOT a general DB console.
 *   - Convention still applies: schema-qualify with public. and never touch pr/pr_*.
 * Override the MCP entry with CRM_CB_MCP_CLI if the npx cache layout changes.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function parseArgs(argv) {
  const args = { limit: 200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') args.file = argv[++i];
    else if (a === '--sql') args.sql = argv[++i];
    else if (a === '--stdin') args.stdin = true;
    else if (a === '--limit') args.limit = Number.parseInt(argv[++i], 10);
    else if (a === '--snapshot') args.snapshot = true;
    else if (a === '--out') args.out = argv[++i];
    else throw new Error('Unknown argument: ' + a);
  }
  return args;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// Strip line/block comments and collapse whitespace, then validate the statement shape.
function assertReadOnly(sql) {
  let s = sql;
  s = s.replace(/--[^\n\r]*/g, ' ');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const trimmed = s.trim().replace(/;\s*$/, '');
  if (!trimmed) throw new Error('Empty SQL.');
  if (/;\s*\S/.test(trimmed)) throw new Error('Only one SQL statement is allowed per invocation.');
  const first = trimmed.split(/\s+/, 1)[0].toUpperCase();
  if (first !== 'SELECT' && first !== 'WITH') {
    throw new Error('Only SELECT/WITH read-only statements are allowed; got: ' + first);
  }
  // Block obvious non-read-only constructs even inside CTEs (PG would also reject them, but fail closed).
  const body = trimmed.toUpperCase();
  for (const kw of ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'GRANT', 'REVOKE', 'CALL', 'DO', 'COMMENT', 'REINDEX', 'VACUUM']) {
    if (new RegExp('(^|[^A-Z_])' + kw + '([^A-Z_]|$)').test(body)) throw new Error('Read-only tool rejects keyword: ' + kw);
  }
  return trimmed;
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

function runQuery(cli, sql, limit) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [cli], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('MCP query timed out after 90s.')); }, 90000);
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
        try { parsed = JSON.parse(text); } catch { return reject(new Error('MCP returned non-JSON result: ' + text.slice(0, 300))); }
        if (parsed.success !== true) return reject(new Error('Query failed: ' + (parsed.message || JSON.stringify(parsed).slice(0, 300))));
        return resolve(parsed.data);
      }
    });
    p.stderr.on('data', () => {});
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'crm-pg-readonly', version: '1.0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'queryPgDatabase', arguments: { action: 'sql', sql, limit } } }), 800);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let sql = args.sql || '';
  if (args.file) sql = fs.readFileSync(path.resolve(args.file), 'utf8');
  else if (args.stdin) sql = await readStdin();
  const clean = assertReadOnly(sql);
  const cli = resolveMcpCli();
  const data = await runQuery(cli, clean, args.limit);
  let output;
  if (args.snapshot) {
    if (data.returnedRows !== 1 || !data.rows?.[0]?.snapshot) throw new Error('--snapshot expects exactly one row with a "snapshot" JSON column.');
    let snap = data.rows[0].snapshot;
    if (typeof snap === 'string') snap = JSON.parse(snap);
    output = JSON.stringify(snap, null, 2) + '\n';
  } else {
    output = JSON.stringify({ cli, columns: data.columns, rows: data.rows, returnedRows: data.returnedRows, truncated: data.truncated }, null, 2) + '\n';
  }
  if (args.out) fs.writeFileSync(path.resolve(args.out), output, 'utf8');
  else process.stdout.write(output);
}

main().catch((e) => { console.error('pg-readonly ERROR: ' + e.message); process.exit(1); });
