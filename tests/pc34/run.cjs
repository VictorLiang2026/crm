'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const checks = [
  ['public role matrix and bilingual dictionary', ['--test', 'tests/pc34/role-matrix.test.cjs', 'tests/pc34/i18n-coverage.test.cjs']],
  ['actual service_role read-only access', ['tests/pc34/service-role-runtime.cjs']],
  ['Person to feedback isolated chain', ['tests/pc34/business-chain.cjs']],
  ['iPad bilingual touch and keyboard', ['--test', 'tests/pc34/ipad-bilingual.browser.cjs']],
];
for (const [label, args] of checks) {
  const run = spawnSync(process.execPath, args, {
    cwd: root, encoding: 'utf8', windowsHide: true,
    timeout: label === 'iPad bilingual touch and keyboard' ? 300000 : 180000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (label === 'actual service_role read-only access' && run.status === 2) {
    console.error((run.stderr || 'PC34 service_role unavailable').trim());
    process.exit(2);
  }
  if (run.error || run.status !== 0) {
    if (run.stderr) process.stdout.write(run.stderr.slice(-4000));
    throw Error(`PC34 ${label} failed: ${(run.stderr || '')}\n${(run.stdout || '').slice(-4000)}`);
  }
  process.stdout.write(`PASS PC34 ${label}\n`);
}
