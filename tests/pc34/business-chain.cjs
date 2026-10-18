'use strict';
// Release-critical isolated coverage for one fictional Person across the new modules.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const chain = [
  ['Person', 'tests/pc04/person-customer-operations.test.cjs'],
  ['Interaction', 'tests/interactions/interaction-service.cjs'],
  ['Fact', 'tests/context-items-lifecycle.test.cjs'],
  ['Relationship', 'tests/relationships/relationship-service.test.cjs'],
  ['Opportunity', 'tests/pc15/opportunity-directory-service.test.cjs'],
  ['Opportunity command', 'tests/pc27/opportunity-command.test.cjs'],
  ['Action', 'tests/actions/action-service.cjs'],
  ['Action command', 'tests/pc26/action-command.test.cjs'],
  ['Outcome and feedback', 'tests/pc29/ai-experience.test.cjs'],
  ['Learning replay', 'tests/pc32/learning-contract.test.cjs']
];
for (const [area, file] of chain) {
  if (!fs.existsSync(path.join(root, file))) throw Error(`Missing PC34 ${area} regression: ${file}`);
}
const run = spawnSync(process.execPath,
  ['--test', '--test-reporter=tap', ...chain.map(([, file]) => file)],
  { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 150000, maxBuffer: 4 * 1024 * 1024 });
if (run.error || run.status !== 0) {
  throw Error(`PC34 Person→feedback chain failed: ${(run.stderr || '')}\n${(run.stdout || '').slice(-4000)}`);
}
const summary = run.stdout.match(/# pass (\d+)[\s\S]*?# fail (\d+)/);
if (!summary || Number(summary[1]) < chain.length || Number(summary[2]) !== 0) {
  throw Error('PC34 Person→feedback chain did not report all test areas');
}
process.stdout.write(`PC34 Person→feedback chain: ${chain.length} areas, ${summary[1]} checks PASS, 0 FAIL\n`);
module.exports = { chain };
