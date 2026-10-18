'use strict';
// One read-only production SELECT. Never returns business rows or credentials.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const cliRoot = process.env.CRM_PC34_CLI_ROOT || path.join(process.env.APPDATA || '', 'npm/node_modules/@cloudbase/cli');
if (!fs.existsSync(path.join(cliRoot, 'package.json'))) {
  console.error('PC34 service_role UNVERIFIED: CloudBase CLI is unavailable');
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8'));
const cli = path.resolve(cliRoot, typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.tcb);
if (!cli.startsWith(path.resolve(cliRoot) + path.sep)) throw Error('Unexpected CloudBase CLI entry');
const sql = `SELECT current_user::text AS role_name,
  NOT EXISTS (SELECT 1 FROM public.ai_results WHERE false) AS ai_results_read,
  NOT EXISTS (SELECT 1 FROM public.ai_request_claims WHERE false) AS ai_claims_read,
  NOT EXISTS (SELECT 1 FROM public.actions WHERE false) AS actions_read,
  NOT EXISTS (SELECT 1 FROM public.outcomes WHERE false) AS outcomes_read,
  has_table_privilege('anon', 'public.ai_results', 'SELECT') AS anon_ai_read,
  has_table_privilege('authenticated', 'public.ai_results', 'SELECT') AS auth_ai_read,
  has_function_privilege('service_role', 'public.crm_ai_claim_v2(text,text,text,text,text,text,text,jsonb,jsonb)', 'EXECUTE') AS service_claim,
  has_function_privilege('anon', 'public.crm_ai_claim_v2(text,text,text,text,text,text,text,jsonb,jsonb)', 'EXECUTE') AS anon_claim,
  has_function_privilege('authenticated', 'public.crm_ai_claim_v2(text,text,text,text,text,text,text,jsonb,jsonb)', 'EXECUTE') AS auth_claim`;
if (/\bpr\.|\bpr_[a-z]/i.test(sql)) throw Error('SQL outside public CRM scope');
const run = spawnSync(process.execPath,
  [cli, 'db', 'execute', '-e', 'crm-d1gkae8ddc930d151', '--role', 'service_role', '--sql', sql, '--json'],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 100000 });
if (run.error || run.status !== 0) {
  const detail = (run.stderr || run.stdout || run.error?.message || '').slice(-800);
  if (/Cam authentication failed|ACCESS_TOKEN_INVALID|credential.*(?:missing|expired|invalid)/i.test(detail)) {
    console.error('PC34 service_role UNVERIFIED: authorized management credential unavailable');
    process.exit(2);
  }
  throw Error(`PC34 service-role read failed: ${detail}`);
}
const output = run.stdout || '';
const start = output.indexOf('{');
if (start < 0) throw Error('PC34 service-role result missing');
const data = JSON.parse(output.slice(start)).data;
if (data?.Rows?.length !== 1 || data.AffectedRows !== 0) throw Error('PC34 service-role shape/side-effect mismatch');
const row = JSON.parse(data.Rows[0]);
if (row.length !== 10 || row[0] !== 'service_role' || row.slice(1, 5).some(x => x !== 'true') ||
    row.slice(5, 7).some(x => x !== 'false') || row[7] !== 'true' ||
    row.slice(8).some(x => x !== 'false')) throw Error('PC34 service-role allow/deny mismatch');
process.stdout.write('PC34 service_role: four public reads allowed; AI table/RPC browser roles denied; zero writes\n');
