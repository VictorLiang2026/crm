'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { unwrap, evaluate } = require('../security/run.cjs');
const { probe } = require('../security/gateway-probe.cjs');
const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'tests/security/.results');
const environment = 'crm-d1gkae8ddc930d151';
const maxAgeMs = 60 * 60 * 1000;
const reportFile = path.join(dir, 'wp01-report.json');
const catalogFile = path.join(dir, 'wp01-catalog.json');
const labels = { PASS: '自动通过', FAIL: '失败', MANUAL_LOGIN: '需人工登录', UNVERIFIED: '未验证' };
const critical = ['catalog', 'regression', 'guard-tests', 'anonymous', 'wp02-fixtures', 'wp03-fixtures', 'wp04-identity'];
const sha = input => crypto.createHash('sha256').update(input).digest('hex');
function fresh(date, now = Date.now()) {
  const age = now - Date.parse(date);
  return Number.isFinite(age) && age >= -60000 && age <= maxAgeMs;
}
function fingerprint() {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(f => /^(admin\.html|package\.json|cloudbaserc\.json)$|^(crm|cloudfunctions|cloudbase|tools|tests)\//.test(f));
  return sha([...new Set(files)].sort().map(f => f + '\0' + (fs.existsSync(path.join(root, f)) ? sha(fs.readFileSync(path.join(root, f))) : 'MISSING')).join('\n'));
}
function blockers(report, currentFingerprint, now = Date.now()) {
  const reasons = [];
  if (report.environment !== environment || report.version !== 1) reasons.push('Wrong report environment/version');
  if (!fresh(report.finishedAt, now)) reasons.push('Report missing or older than one hour');
  if (report.fingerprint !== currentFingerprint) reasons.push('Source/test/tool files changed after checks');
  const rows = Array.isArray(report.checks) ? report.checks : [];
  if (new Set(rows.map(r => r.id)).size !== rows.length) reasons.push('Duplicate check IDs');
  for (const id of critical) if (rows.find(r => r.id === id)?.status !== 'PASS') reasons.push(id + ' not verified');
  for (const row of rows) {
    if (!Object.hasOwn(labels, row.status)) reasons.push('Unknown result status: ' + row.id);
    if (row.status === 'FAIL') reasons.push(row.id + ' failed');
  }
  if (!fresh(report.catalogObservedAt, now)) reasons.push('Catalog evidence expired');
  return reasons;
}
function catalog(raw, now = Date.now()) {
  const actual = unwrap(raw);
  if (actual.environment !== environment || actual.version !== 'wp01-v1') throw Error('Wrong catalog environment/version; export catalog.sql');
  if (!fresh(actual.observedAt, now)) throw Error('Catalog evidence expired; rerun catalog.sql');
  const result = evaluate(actual);
  const expectedRoles = require('./expected-roles.json');
  for (const expected of expectedRoles) {
    const found = actual.roles?.find(r => r.name === expected.name);
    if (!found || Object.keys(expected).some(k => found[k] !== expected[k])) result.failures.push('Role attributes drift: ' + expected.name);
    result.checks++;
  }
  if (actual.roles?.length !== expectedRoles.length) result.failures.push('Role evidence incomplete');
  return { actual, result };
}
function runNode(args) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0 || r.error) throw Error('Check process failed: ' + args.join(' '));
}
function loginRows(file, now = Date.now()) {
  if (!fs.existsSync(file)) return [{ id: 'login', status: 'MANUAL_LOGIN', detail: 'npm run test:wp01:login' }];
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const valid = r.environment === environment && fresh(r.observedAt, now) &&
    r.adminHash === sha(fs.readFileSync(path.join(root, 'admin.html')));
  // A recorded failure is never silently downgraded to an optional skip.
  if (r.results?.some(x => x.status === 'FAIL')) return [{ id: 'login', status: 'FAIL', detail: 'Latest interactive probe failed' }];
  if (!valid) return [{ id: 'login', status: 'MANUAL_LOGIN', detail: 'Login evidence expired or page changed' }];
  const names = require('../security/expected-public-baseline.json').objects.filter(x => x.kind === 'relation').map(x => x.name);
  const ok = id => r.results?.find(x => x.id === id)?.status === 'PASS';
  return [
    { id: 'login', status: ok('live.login') ? 'PASS' : 'MANUAL_LOGIN', detail: 'Real getSession; separate test profile' },
    { id: 'authenticated', status: names.every(n => ok('authenticated.' + n)) ? 'PASS' : 'UNVERIFIED', detail: '47 HEAD reads denied with authenticated JWT; not a write test' },
    { id: 'function-read', status: ok('live.function.customers') ? 'PASS' : 'UNVERIFIED', detail: 'Existing customers.list, unique fictional keyword, zero rows' }
  ];
}
async function main(args = process.argv.slice(2)) {
  if (args.some(a => !['--assert-release','--psql'].includes(a)) || args.length > 1) throw Error('Usage: run.cjs [--assert-release|--psql]');
  fs.mkdirSync(dir, { recursive: true });
  if (args.includes('--assert-release')) {
    if (!fs.existsSync(reportFile)) throw Error('WP01 gate report missing; run npm run test:wp01');
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const reasons = blockers(report, fingerprint());
    // Re-evaluate raw evidence: replacing or deleting a failing snapshot cannot bless a cached report.
    if (!fs.existsSync(catalogFile) || sha(fs.readFileSync(catalogFile)) !== report.catalogHash) reasons.push('Catalog input changed/missing');
    if (fs.existsSync(catalogFile)) {
      try { const c = catalog(fs.readFileSync(catalogFile, 'utf8')); reasons.push(...c.result.failures); } catch(e) { reasons.push(e.message); }
    }
    const loginFile = path.join(dir, 'wp01-login.json');
    if ((fs.existsSync(loginFile) ? sha(fs.readFileSync(loginFile)) : null) !== report.loginHash) reasons.push('Login evidence changed; rerun gate');
    const identityFile = path.join(dir,'wp04-audit.json');
    if (!fs.existsSync(identityFile) || sha(fs.readFileSync(identityFile)) !== report.identityHash) reasons.push('WP04 identity evidence changed/missing');
    if (fs.existsSync(identityFile)) {
      try { reasons.push(...require('../wp04/audit.cjs').evaluate(JSON.parse(fs.readFileSync(identityFile,'utf8')),require('../wp04/exceptions.json')).failures); }
      catch { reasons.push('Invalid WP04 identity evidence'); }
    }
    if (reasons.length) throw Error(reasons.join('; '));
    console.log('WP01 gate PASS. Open verification items: ' + report.checks.filter(r => r.status !== 'PASS').map(r => r.id).join(', '));
    return;
  }
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });
  const before = fingerprint();
  let catalogObservedAt = null, catalogHash = null;
  if (args.includes('--psql')) {
    if (!process.env.CRM_SECURITY_PG_URL) throw Error('CRM_SECURITY_PG_URL required; never put credentials in command arguments');
    const r = spawnSync('psql', ['-X','-q','-t','-A','-1','-v','ON_ERROR_STOP=1','-f',path.join(__dirname,'catalog.sql')], {
      encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, PGDATABASE: process.env.CRM_SECURITY_PG_URL, PGOPTIONS: '-c default_transaction_read_only=on' } });
    if (r.status !== 0 || r.error) throw Error('Private read-only PG query failed');
    catalog(r.stdout); // Validate before replacing any evidence.
    fs.writeFileSync(catalogFile, r.stdout);
  }
  if (!fs.existsSync(catalogFile)) add('catalog', 'UNVERIFIED', 'Export fresh catalog.sql through authorized CloudBase MCP or use --psql');
  else {
    try {
      const raw = fs.readFileSync(catalogFile);
      const c = catalog(raw.toString());
      catalogHash = sha(raw); catalogObservedAt = c.actual.observedAt;
      add('catalog', c.result.failures.length ? 'FAIL' : 'PASS', c.result);
    } catch(e) { add('catalog', 'UNVERIFIED', e.message); }
  }
  // A permission drift stops subsequent test calls and publishing.
  if (!checks.some(c => c.status === 'FAIL')) {
    for (const [id, args] of [
      ['guard-tests', ['--test','tests/security/run.test.cjs','tests/wp01/gate.test.cjs','tests/tooling/cloudbase-sdk-pins.cjs','tests/recruit-goals/transactional-save.cjs']],
      ['wp02-fixtures', ['--test','tests/wp02/run.test.cjs','tests/wp02/browser.test.cjs']],
      ['wp03-fixtures', ['--test','tests/wp03/run.test.cjs','tests/wp03/browser.test.cjs']],
      ['wp04-identity', ['tests/wp04/run.cjs']],
      ['regression', ['tests/regression/run.cjs']]
    ]) {
      try { runNode(args); add(id, 'PASS', id === 'wp04-identity' ? 'Fresh public read-only identity audit plus offline fixtures; explicit exceptions retained in wp04-report.json' : 'Offline fixtures; see per-case report'); }
      catch(e) { add(id, 'FAIL', e.message); break; }
    }
  }
  if (!checks.some(c => c.status === 'FAIL')) {
    const keyFile = process.env.CRM_PUBLIC_KEY_FILE || path.join(root,'tests/permissions/.results/public-key.txt');
    if (!fs.existsSync(keyFile)) add('anonymous','UNVERIFIED','Anonymous publishable key file missing');
    else {
      try {
        const r = await probe();
        fs.writeFileSync(path.join(dir,'wp01-anonymous.json'), JSON.stringify(r,null,2) + '\n');
        add('anonymous', r.failed ? 'FAIL' : 'PASS', { checked:r.checked, passed:r.passed, failed:r.failed });
      } catch { add('anonymous','UNVERIFIED','Gateway could not be reached; no pass inferred'); }
    }
  }
  checks.push(...loginRows(path.join(dir,'wp01-login.json')));
  add('service-runtime','UNVERIFIED','Service_role catalog grants checked; no service key or write probe executed');
  add('live-writes','UNVERIFIED','No production create/update/delete/restore, AI or external messages');
  add('mobile','UNVERIFIED','Isolated desktop smoke is not real mobile visual acceptance');
  const current = fingerprint();
  if (current !== before) add('concurrent-change','FAIL','Files changed during tests; rerun after reviewing changes');
  const loginFile = path.join(dir,'wp01-login.json');
  const report = { version:1, environment, startedFingerprint:before, fingerprint:current,
    head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    finishedAt:new Date().toISOString(), catalogObservedAt, catalogHash,
    loginHash:fs.existsSync(loginFile) ? sha(fs.readFileSync(loginFile)) : null, checks };
  const identityFile = path.join(dir,'wp04-audit.json');
  report.identityHash = fs.existsSync(identityFile) ? sha(fs.readFileSync(identityFile)) : null;
  report.blockers = blockers(report, current);
  report.releaseGate = report.blockers.length ? 'BLOCKED' : 'PASS_WITH_LIMITATIONS';
  fs.writeFileSync(reportFile, JSON.stringify(report,null,2) + '\n');
  const regressionFile = path.join(root,'tests/regression/.results/latest.json');
  const regression = checks.some(c => c.id === 'regression' && c.status === 'PASS') && fs.existsSync(regressionFile)
    ? JSON.parse(fs.readFileSync(regressionFile,'utf8')) : null;
  const lines = ['# WP01 运行报告','', '生成时间：' + report.finishedAt, '', '发布门槛：' + report.releaseGate, '',
    '| 检查 | 状态 |', '| --- | --- |', ...checks.map(c => '| ' + c.id + ' | ' + labels[c.status] + ' |'),
    '', '阻断原因：' + (report.blockers.join('; ') || '无'), '', '## 旧路由 smoke（隔离夹具）','',
    '| ID | 项目 | 状态 |','| --- | --- | --- |',
    ...(regression?.results || []).filter(r => r.layer?.includes('browser')).map(r => '| ' + r.id + ' | ' + r.title + ' | ' + r.status + ' |'),
    '', '源码一致性另运行 tools/sync-check.ps1；本报告不宣称线上写入、服务角色或移动端验证完成。',''];
  fs.writeFileSync(path.join(dir,'wp01-report.md'), lines.join('\n'));
  console.log(JSON.stringify({ releaseGate:report.releaseGate, checks, blockers:report.blockers },null,2));
  process.exitCode = report.blockers.length ? (checks.some(c => c.status === 'FAIL') ? 1 : 2) : 0;
}
if (require.main === module) main().catch(e => { console.error('WP01 BLOCKED: ' + e.message); process.exitCode = 1; });
module.exports = { fresh, blockers, catalog, fingerprint, loginRows };
