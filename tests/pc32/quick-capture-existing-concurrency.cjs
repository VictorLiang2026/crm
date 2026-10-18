/** Independent service-role CLI processes; only registered fictional Person 783 is used. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const cliRoot = path.join(process.env.APPDATA, 'npm/node_modules/@cloudbase/cli');
const manifest = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8'));
const cli = path.resolve(cliRoot, typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.tcb);
if (!cli.startsWith(path.resolve(cliRoot) + path.sep)) throw Error('Unexpected CLI entry');
const env = 'crm-d1gkae8ddc930d151';
const key = '00000000-0000-4000-8000-000000032032';
const lock = `capture_v2:${key}`;
function run(sql) {
  if (/\bpr\.|\bpr_[a-z]/i.test(sql)) throw Error('Outside public CRM scope');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      [cli, 'db', 'execute', '-e', env, '--role', 'service_role', '--sql', sql, '--json'],
      { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 200000) child.kill(); });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 45000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(Error('Independent SQL process failed (exit ' + code + ')'));
      try {
        const parsed = JSON.parse(output.slice(output.indexOf('{')));
        if (!parsed.data) throw Error('No SQL result');
        resolve(parsed.data);
      } catch { reject(Error('Invalid independent SQL response')); }
    });
  });
}
async function main() {
  const holderSql = `BEGIN;
    SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('${lock}',0));
    SELECT pg_catalog.pg_sleep(12);
    ROLLBACK;`;
  const contenderSql = `BEGIN;
    SET LOCAL lock_timeout='500ms';
    DO $test$ BEGIN
      BEGIN
        PERFORM public.person_identity_preview_v1('2102162853214060545',
          '${key}'::uuid,'capture_v2_existing',
          jsonb_build_object('display_name','【系统测试·勿联系】虚构体验甲',
            'name_key',lower('【系统测试·勿联系】虚构体验甲'),
            'person_id',783,'source','人工新增','occupation','',
            'organization','','education','',
            'interaction',jsonb_build_object('type','微信',
              'at','2026-10-18T12:00:00Z','channel','',
              'summary','【系统测试·勿联系】PC32-D 并发探针',
              'rawNote','【系统测试·勿联系】纯虚构原话'),
            'facts',jsonb_build_array('【系统测试·勿联系】虚构事实'),
            'signals',jsonb_build_array('【系统测试·勿联系】虚构信号')));
        RAISE EXCEPTION 'PC32-D concurrent preview unexpectedly acquired lock';
      EXCEPTION WHEN lock_not_available THEN NULL;
      END;
    END $test$;
    ROLLBACK;`;
  const holder = run(holderSql);
  const settled = holder.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
  try {
    let observed = false;
    for (let i = 0; i < 3 && !observed; i++) {
      const peek = await run(`SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks
        WHERE locktype='advisory' AND granted AND objsubid=1
          AND classid::bigint=((pg_catalog.hashtextextended('${lock}',0)>>32)&4294967295)
          AND objid::bigint=(pg_catalog.hashtextextended('${lock}',0)&4294967295)) AS held`);
      const row = typeof peek.Rows?.[0] === 'string' ? JSON.parse(peek.Rows[0]) : peek.Rows?.[0];
      observed = row?.[0] === true || row?.[0] === 'true';
    }
    if (!observed) throw Error('No overlapping advisory lock observed');
    const contender = await run(contenderSql);
    const holding = await settled;
    if (!holding.ok) throw holding.error;
    const testSql = fs.readFileSync(path.join(__dirname, 'quick-capture-existing-transaction.sql'), 'utf8')
      .replace('v_key uuid := pg_catalog.gen_random_uuid();', `v_key uuid := '${key}'::uuid;`);
    if (!testSql.includes(`v_key uuid := '${key}'::uuid;`)) throw Error('Retry fixture key not bound');
    const retry = await run(testSql);
    const report = { environment: env, observedAt: new Date().toISOString(),
      observedOverlappingLock: true, lockTimeoutRejectedWithoutWrite: true,
      retryAndFullTransactionPassed: true,
      holderExecutionMs: holding.value.ExecutionTimeMs,
      contenderExecutionMs: contender.ExecutionTimeMs,
      retryExecutionMs: retry.ExecutionTimeMs, persistentBusinessWrites: false };
    fs.writeFileSync(path.join(root, 'tests/security/.results/pc32-d-concurrency.json'),
      JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await settled; }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
