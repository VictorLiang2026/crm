'use strict';
// Read-only checks for one human-confirmed fictional Person follow-up and fact.
// Credentials and response bodies remain in the browser; only pass/fail leaves it.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');

const followupId = process.argv[2];
if (!/^[1-9]\d*$/.test(followupId || '')) throw Error('Expected fictional follow-up ID');
const phase = process.argv[3] || 'initial';
if (!['initial', 'after-legacy-edit', 'after-expire'].includes(phase)) throw Error('Invalid E04 phase');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const start = source.indexOf('var authInst = null;');
const end = source.indexOf('// ==================== 表单生成');
const sdk = source.match(/https:\/\/static\.cloudbase\.net\/cloudbase-js-sdk\/\d+\.\d+\.\d+\/cloudbase\.full\.js/)?.[0];
if (start < 0 || end <= start || !sdk) throw Error('CRM login source anchors changed');
const envId = 'crm-d1gkae8ddc930d151';
const nonce = crypto.randomBytes(24).toString('hex');

async function probe(nonce, followupId, phase) {
  const view = document.getElementById('view');
  const records = [];
  const expectedSummary = phase !== 'initial'
    ? '【系统测试·勿联系】PC36 E04 虚构客户跟进；旧页修订；禁止联系和外发'
    : '【系统测试·勿联系】PC36 E04 虚构客户跟进；禁止联系和外发';
  try {
    await initSdk();
    await ensureSession();
    if (!(await authInst.getSession())?.data?.session) throw Error('NO_SESSION');
    const checks = [
      ['fact-state', 'person_360', { action: 'getContextGroups', personId: '784' }, value => {
        const fact = value?.groups?.fact?.find(row => String(row.id) === '67');
        const signal = value?.groups?.signal?.find(row => String(row.id) === '68');
        return fact?.confirmed === true && String(fact?.interactionId) === '23' &&
          (phase === 'after-expire' ? fact?.validity === 'expired' && fact?.lifecycle === 'expire'
            : fact?.validity === 'current') &&
          signal?.confirmed === false && String(signal?.interactionId) === '23';
      }],
      ['ai-context', 'person_360', { action: 'getMeetingPrepContext', personId: '784' }, value =>
        (phase === 'after-expire'
          ? !value?.facts?.some(row => String(row.source?.id) === '67')
          : value?.facts?.some(row => String(row.source?.id) === '67' && row.confirmed === true)) &&
        value?.signals?.some(row => String(row.source?.id) === '68' && row.certainty === 'unverified_signal')],
      ['legacy-followup', 'followups', { action: 'list', customer_id: 791 }, value =>
        value?.rows?.some(row => String(row.Id) === followupId && String(row.customer_id) === '791' &&
          row.deleted_at == null && row.interaction_summary === expectedSummary)],
      ['unified-timeline', 'person_360', { action: 'getTimelinePage', personId: '784', page: 1, pageSize: 20 }, value =>
        value?.rows?.filter(row => row.source === `public.followups#${followupId}` && row.summary === expectedSummary).length === 1 &&
        value?.rows?.filter(row => row.source === 'public.interactions#23').length === 1],
    ];
    for (const [id, fn, data, valid] of checks) {
      view.textContent = `PC36 E04 只读核查 / Read-only check: ${id}`;
      const at = performance.now();
      try {
        const result = await Promise.race([
          callFn(fn, data),
          new Promise((_, reject) => setTimeout(() => reject(Error('TIMEOUT')), 45000)),
        ]);
        records.push({ id, status: result && !result.error && valid(result) ? 'PASS' : 'FAIL',
          ms: Math.round(performance.now() - at) });
      } catch {
        records.push({ id, status: 'FAIL', ms: Math.round(performance.now() - at) });
      }
    }
  } catch { records.push({ id: 'login', status: 'FAIL', ms: 0 }); }
  try {
    const saved = await fetch('/result', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Probe-Nonce': nonce,
    }, body: JSON.stringify({ records }) });
    view.textContent = saved.ok
      ? '只读结果已保存，请等待核对。 / Read-only results saved.'
      : '保存结果失败。 / Could not save results.';
  } catch { view.textContent = '保存结果失败。 / Could not save results.'; }
  try { await authInst.signOut(); } catch { view.textContent += ' 请关闭窗口。 / Please close this window.'; }
}

const html = '<!doctype html><meta charset="utf-8"><title>PC36 E04 只读核查</title>' +
  '<style>body{font:16px sans-serif;max-width:760px;margin:48px auto}input,button{padding:12px;margin:8px}</style>' +
  '<h1>PC36 E04 只读核查 / Read-only integration check</h1>' +
  '<p>请登录 CRM。仅查询已登记的虚构 Person #784、客户 #791、事实与跟进；不写业务数据、不调用模型、不保存凭据或正文。</p>' +
  '<div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div>' +
  '<script src="' + sdk + '"></script><script>var CONFIG={envId:' + JSON.stringify(envId) + '};' +
  'var app=null;function route(){}' + source.slice(start, end) +
  '\n(' + probe.toString() + ')(' + JSON.stringify(nonce) + ',' + JSON.stringify(followupId) + ',' +
  JSON.stringify(phase) + ');</script>';

const allowed = new Set(['fact-state', 'ai-context', 'legacy-followup', 'unified-timeline', 'login']);
let origin;
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;
  }
  if (req.method !== 'POST' || req.url !== '/result' || req.headers.origin !== origin ||
    req.headers['x-probe-nonce'] !== nonce) { res.writeHead(403); res.end(); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 10000) req.destroy(); });
  req.on('end', () => {
    try {
      const records = JSON.parse(body).records;
      if (!Array.isArray(records) || records.length < 1 || records.length > 4 ||
        records.some(row => !allowed.has(row.id) || !['PASS', 'FAIL'].includes(row.status) ||
          !Number.isFinite(row.ms) || row.ms < 0)) throw Error('Invalid summary');
      const report = { environment: envId, observedAt: new Date().toISOString(), phase, records };
      const dir = path.join(root, 'tests/security/.results');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'pc36-live-e04-readonly.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report));
      res.end('ok'); setTimeout(() => server.close(), 1000);
    } catch { res.writeHead(400); res.end('Invalid summary'); }
  });
});
server.listen(0, '127.0.0.1', () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  console.log('PC36 E04 login: ' + origin);
  const browser = spawn(process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--new-window', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'crm-pc36-e04-')), origin],
    { stdio: 'ignore', detached: true });
  browser.on('error', () => { server.close(); process.exitCode = 1; });
  browser.unref();
});
