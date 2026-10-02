'use strict';
// Anonymous HEAD + exact count. The funnel's fixed-dimension rows are checked
// through aggregate columns only; no customer/person rows or values are logged.
const fs = require('node:fs');
const path = require('node:path');

const envId = 'crm-d1gkae8ddc930d151';
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected-public-baseline.json'), 'utf8'));
const defaultKeyFile = path.join(__dirname, '..', 'permissions', '.results', 'public-key.txt');

function classify(status, range, expectsSelect) {
  if (expectsSelect) return status === 200 && range === '*/0';
  return status === 401 || status === 403;
}

const funnelMetrics = ['current_count', 'entered_30d', 'moved_30d', 'overdue_count', 'dwell_median_days', 'stuck_count'];
function emptyFunnelMetrics(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows.length <= 100 && rows.every(row =>
    row && typeof row === 'object' && Object.keys(row).length === funnelMetrics.length &&
    funnelMetrics.every(name => Object.hasOwn(row, name) &&
      (row[name] === null || (row[name] !== '' && Number.isFinite(Number(row[name])) && Number(row[name]) === 0))));
}

async function probe() {
  const keyFile = process.env.CRM_PUBLIC_KEY_FILE || defaultKeyFile;
  if (!fs.existsSync(keyFile)) throw new Error('Publishable anonymous key file missing; gateway test was not run');
  const key = fs.readFileSync(keyFile, 'utf8').trim();
  if (!key || /\s/.test(key)) throw new Error('Invalid anonymous key file');
  const objects = baseline.objects.filter(item => item.kind === 'relation');
  const results = [];
  for (const item of objects) {
    const expectsSelect = item.detail.privileges.anon.includes('SELECT');
    const url = new URL(`https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest/${encodeURIComponent(item.name)}`);
    const funnel = item.name === 'v_funnel_stats';
    url.search = new URLSearchParams(funnel ? {
      select: funnelMetrics.join(',')
    } : { select: '*', limit: '0' }).toString();
    const response = await fetch(url, { method: 'HEAD', headers: {
      Authorization: `Bearer ${key}`, 'Accept-Profile': 'public', Prefer: 'count=exact'
    }, signal: AbortSignal.timeout(20000) });
    if (funnel) {
      const full = await fetch(url, { headers: { Authorization: `Bearer ${key}`, 'Accept-Profile': 'public' },
        signal: AbortSignal.timeout(20000) });
      const values = await full.json();
      const zeroMetrics = full.status === 200 && emptyFunnelMetrics(values);
      results.push({ object: item.name, status: full.status, empty: false,
        expected: 'fixed dimensions, zero aggregate metrics', pass: zeroMetrics });
      continue;
    }
    const range = response.headers.get('content-range');
    results.push({ object: item.name, status: response.status, empty: range === '*/0',
      expected: expectsSelect ? 'authorized, zero visible rows' : 'denied',
      pass: classify(response.status, range, expectsSelect) });
  }
  const failures = results.filter(result => !result.pass);
  return { environment: envId, checked: results.length, passed: results.length - failures.length,
    failed: failures.length, status: failures.length ? 'FAIL' : 'PASS', results };
}

async function main() {
  const outputAt = process.argv.indexOf('--output');
  if (outputAt >= 0 && !process.argv[outputAt + 1]) throw new Error('--output requires a file path');
  const report = await probe();
  if (outputAt >= 0) fs.writeFileSync(process.argv[outputAt + 1], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ environment: report.environment, checked: report.checked,
    passed: report.passed, failed: report.failed, failures: report.results.filter(item => !item.pass) }, null, 2));
  if (report.failed) process.exitCode = 1;
}

if (require.main === module) main().catch(error => {
  console.error(`Anonymous gateway test failed closed: ${error.name}: ${error.message}`);
  process.exitCode = 1;
});
module.exports = { classify, emptyFunnelMetrics, probe };
