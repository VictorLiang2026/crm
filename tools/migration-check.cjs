#!/usr/bin/env node
/*
 * migration-check.cjs — PMC-03 read-only migration verification runner.
 *
 * Executes tools/migration-check.sql via the pg-readonly MCP channel, evaluates
 * failures against fixed thresholds (no online-result backfill), and writes a
 * JSON report. PII-free: the SQL returns only counts/mappings/orphans/roles and
 * a column-name fingerprint (no name/phone/wechat/notes values).
 *
 * Usage:
 *   node tools/migration-check.cjs [--out <path>]
 *
 * Output: { version, schema, environment, observedAt, counts, mappings, orphans,
 *           roles, softdelete_cross, nulls, pagination, failures, status }
 * status: PASS (no blocker) | FAIL (any blocker) | PASS_WITH_EXCEPTIONS (only non-blocker)
 *
 * Safety: read-only by construction (pg-readonly rejects DDL/DML/multi-statement).
 * Not integrated into release gate (WP01 threshold unchanged).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SQL_FILE = path.join(__dirname, 'migration-check.sql');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else throw new Error('Unknown argument: ' + argv[i]);
  }
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

function runSnapshotQuery(cli, sql) {
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
        const rows = parsed.data?.rows || [];
        if (parsed.data?.returnedRows !== 1 || !rows[0]?.snapshot) {
          return reject(new Error('Expected exactly one row with a "snapshot" JSON column.'));
        }
        let snap = rows[0].snapshot;
        if (typeof snap === 'string') snap = JSON.parse(snap);
        return resolve(snap);
      }
    });
    p.stderr.on('data', () => {});
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'crm-migration-check', version: '1.0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'queryPgDatabase', arguments: { action: 'sql', sql, limit: 1 } } }), 800);
  });
}

function evaluate(snap) {
  const failures = (snap?.failures || []).slice();
  const blockers = failures.filter((f) => f.severity === 'blocker');
  const status = blockers.length > 0 ? 'FAIL' : (failures.length > 0 ? 'PASS_WITH_EXCEPTIONS' : 'PASS');
  return { failures, status, blockerCount: blockers.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const cli = resolveMcpCli();
  const snap = await runSnapshotQuery(cli, sql);
  const evalResult = evaluate(snap);
  const report = {
    version: 'pmc03-v1',
    schema: 'public',
    environment: 'crm-d1gkae8ddc930d151',
    observedAt: new Date().toISOString(),
    counts: snap.counts,
    mappings: snap.mappings,
    orphans: snap.orphans,
    roles: snap.roles,
    softdelete_cross: snap.softdelete_cross,
    nulls: snap.nulls,
    pagination: snap.pagination,
    failures: evalResult.failures,
    status: evalResult.status,
    blockerCount: evalResult.blockerCount,
    cli,
  };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(path.resolve(args.out), output, 'utf8');
    console.log(`[PASS] Wrote ${args.out} status=${report.status} blockers=${report.blockerCount}`);
  } else {
    process.stdout.write(output);
  }
  if (report.status === 'FAIL') process.exitCode = 1;
}

main().catch((e) => { console.error('migration-check ERROR: ' + e.message); process.exitCode = 1; });
