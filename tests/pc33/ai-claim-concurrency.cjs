/** Two independent service-role SQL processes exercise the real public advisory lock. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const cliRoot = path.join(process.env.APPDATA, 'npm/node_modules/@cloudbase/cli');
const manifest = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8'));
const cli = path.resolve(cliRoot, typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.tcb);
if (!cli.startsWith(path.resolve(cliRoot) + path.sep)) throw Error('Unexpected CloudBase CLI entry');
const actor = 'pc33_concurrent_fictional_actor';
const key = 'a'.repeat(64);
const claim = `public.crm_ai_claim_v2('${actor}','${key}',
  'pc33_test','pc33_test',null,null,'analysis',
  '{"fixture":"【系统测试·勿联系】PC33 并发"}'::jsonb,
  '{"fixture":"【系统测试·勿联系】PC33 并发"}'::jsonb)`;
function run(sql) {
  if (/\bpr\.|\bpr_[a-z]/i.test(sql)) throw Error('Outside public CRM scope');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      [cli, 'db', 'execute', '-e', 'crm-d1gkae8ddc930d151', '--role', 'service_role', '--sql', sql, '--json'],
      { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 100000) child.kill(); });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 30000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(Error('Independent SQL process failed (exit ' + code + ')'));
      try { resolve(JSON.parse(output.slice(output.indexOf('{')))); }
      catch { reject(Error('Invalid independent SQL response')); }
    });
  });
}
async function main() {
  const holder = run(`BEGIN; SELECT ${claim}; SELECT pg_catalog.pg_sleep(8); ROLLBACK;`);
  const settled = holder.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
  try {
    let observed = false;
    for (let i = 0; i < 5 && !observed; i++) {
      const peek = await run(`SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory'
        AND granted AND objsubid=2
        AND classid::bigint=(pg_catalog.hashtext('${actor}')::bigint & 4294967295)
        AND objid::bigint=(pg_catalog.hashtext('${key}')::bigint & 4294967295)) AS held`);
      const rows = peek.data?.Rows || peek.data?.rows || [];
      observed = JSON.stringify(rows).includes('true');
    }
    if (!observed) throw Error('PC33 advisory lock overlap was not observed');
    const contender = await run(`BEGIN; SET LOCAL lock_timeout='500ms';
      DO $test$ BEGIN
        BEGIN
          PERFORM ${claim};
          RAISE EXCEPTION 'PC33 contender unexpectedly acquired lock';
        EXCEPTION WHEN lock_not_available THEN NULL;
        END;
      END $test$;
      ROLLBACK;`);
    if (!contender.data) throw Error('PC33 contender result missing');
    const holding = await settled;
    if (!holding.ok) throw holding.error;
    const retry = await run(`BEGIN; SELECT ${claim}; ROLLBACK;`);
    if (!retry.data) throw Error('PC33 retry result missing');
    console.log('PC33 independent contention: lock timeout refused; retry succeeded; both transactions rolled back');
  } finally { await settled; }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
