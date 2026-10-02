'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const directory = __dirname;
const baseline = JSON.parse(fs.readFileSync(path.join(directory, 'expected-public-baseline.json'), 'utf8'));
const environment = 'crm-d1gkae8ddc930d151';

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  }
  return value;
}

function unwrap(input) {
  let value = typeof input === 'string' ? JSON.parse(input) : input;
  if (Array.isArray(value?.content)) {
    const block = value.content.find(item => item.type === 'text');
    if (!block) throw new Error('CloudBase response has no text result');
    value = JSON.parse(block.text);
  }
  if (value?.success === false) throw new Error(`CloudBase query failed: ${value.errorCode || 'unknown'}`);
  if (value?.data) {
    if (value.data.truncated || value.data.returnedRows !== 1 || value.data.rows?.length !== 1) {
      throw new Error('CloudBase result is incomplete or truncated');
    }
    value = value.data.rows[0];
  }
  if (value?.snapshot !== undefined) value = value.snapshot;
  if (typeof value === 'string') value = JSON.parse(value);
  if (value?.schema !== 'public' || !Array.isArray(value.objects)) {
    throw new Error('Expected one public-only metadata snapshot');
  }
  return value;
}

function evaluate(actual, approved = baseline) {
  const failures = [];
  let checks = 0;
  const check = (ok, label) => { checks++; if (!ok) failures.push(label); };
  check(actual.schema === 'public', 'Unexpected schema');
  check(Array.isArray(actual.objects) && actual.objects.length > 0, 'Object list empty');
  if (!Array.isArray(actual.objects)) return { checks, failures, counts: {} };
  const key = item => `${item.kind}:${item.name}`;
  const actualMap = new Map(actual.objects.map(item => [key(item), item]));
  const approvedMap = new Map(approved.objects.map(item => [key(item), item]));
  check(actualMap.size === actual.objects.length, 'Duplicate object keys');
  const counts = { tables: 0, views: 0, sequences: 0, routines: 0 };
  for (const item of actual.objects) {
    const id = key(item);
    const prior = approvedMap.get(id);
    check(Boolean(prior), `Unapproved public object: ${id}`);
    if (!prior) continue;
    check(JSON.stringify(normalize(item)) === JSON.stringify(normalize(prior)), `Permission or policy drift: ${id}`);
    if (item.kind === 'relation') {
      const d = item.detail || {};
      const grants = d.privileges || {};
      const requiredRoles = ['anon', 'authenticated', 'service_role'];
      check(requiredRoles.every(role => Array.isArray(grants[role])), `Missing role grant data: ${id}`);
      if (d.type === 'r' || d.type === 'p') {
        counts.tables++;
        check(d.rls === true, `RLS disabled: ${id}`);
        check(Array.isArray(d.policies) && d.policies.length > 0, `No RLS policy: ${id}`);
        check(grants.service_role?.includes('SELECT'), `Service read grant missing: ${id}`);
        if (prior.detail.privileges.anon.length === 0) {
          check(grants.anon?.length === 0, `Server-only table exposed to anon: ${id}`);
          check(d.policies?.every(policy => policy.roles?.length === 1 && policy.roles[0] === 'service_role'),
            `Server-only policy exposed to another role: ${id}`);
        }
      } else if (d.type === 'v' || d.type === 'm') {
        counts.views++;
        check(d.security_invoker === true, `View bypasses caller RLS: ${id}`);
      } else check(false, `Unexpected relation type: ${id}`);
      check(grants.authenticated?.length === 0, `Authenticated table/view grant: ${id}`);
    } else if (item.kind === 'sequence') {
      counts.sequences++;
      const d = item.detail || {};
      if (!prior.detail.anon_usage && !prior.detail.anon_read) {
        check(!d.anon_usage && !d.anon_read, `Server-only sequence exposed to anon: ${id}`);
      }
      if (!prior.detail.authenticated_usage && !prior.detail.authenticated_read) {
        check(!d.authenticated_usage && !d.authenticated_read, `Server-only sequence exposed to authenticated: ${id}`);
      }
    } else if (item.kind === 'routine') {
      counts.routines++;
      check(item.detail?.service_execute === true, `Service routine execution missing: ${id}`);
    } else check(false, `Unexpected object kind: ${id}`);
  }
  for (const id of approvedMap.keys()) check(actualMap.has(id), `Approved object missing: ${id}`);
  return { checks, failures, counts };
}

function readPsql() {
  const url = process.env.CRM_SECURITY_PG_URL;
  if (!url) throw new Error('CRM_SECURITY_PG_URL is required for --psql');
  const result = spawnSync('psql', ['-X', '-q', '-t', '-A', '-1', '-v', 'ON_ERROR_STOP=1', '--dbname', url,
    '-f', path.join(directory, 'verify-public.sql')], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS || ''} -c default_transaction_read_only=on`,
      PGAPPNAME: 'crm-wp13.6-security' } });
  if (result.error || result.status !== 0) throw new Error('Read-only psql query failed; verify the private connection and target environment');
  return result.stdout.trim();
}

function main(args = process.argv.slice(2)) {
  const inputAt = args.indexOf('--input');
  const outputAt = args.indexOf('--output');
  if ((inputAt < 0 && !args.includes('--psql')) || (inputAt >= 0 && args.includes('--psql')) ||
      (inputAt >= 0 && !args[inputAt + 1]) || (outputAt >= 0 && !args[outputAt + 1])) {
    throw new Error('Usage: node tests/security/run.cjs (--input response.json | --psql) [--output report.json]');
  }
  const raw = inputAt >= 0 ? fs.readFileSync(args[inputAt + 1], 'utf8') : readPsql();
  const actual = unwrap(raw);
  const result = evaluate(actual);
  const report = { environment, schema: 'public', generatedAt: new Date().toISOString(),
    ...result, status: result.failures.length ? 'FAIL' : 'PASS',
    limitation: 'Catalog metadata does not prove gateway behavior or a real logged-in session.' };
  if (outputAt >= 0) fs.writeFileSync(args[outputAt + 1], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (result.failures.length) process.exitCode = 1;
  return report;
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`Security test failed closed: ${error.message}`); process.exitCode = 1; }
}
module.exports = { unwrap, evaluate, main };
