'use strict';
// Authenticated negative checks against fictional Persons with active Speaker profiles.
// A successful create is a failure; the caller must separately verify zero new rows.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const start = source.indexOf('var authInst = null;');
const end = source.indexOf('// ==================== 表单生成');
const sdk = source.match(/https:\/\/static\.cloudbase\.net\/cloudbase-js-sdk\/\d+\.\d+\.\d+\/cloudbase\.full\.js/)?.[0];
if (start < 0 || end <= start || !sdk) throw Error('CRM login source anchors changed');

const envId = 'crm-d1gkae8ddc930d151';
const nonce = crypto.randomBytes(24).toString('hex');
const fictionalName = '【系统测试·勿联系】虚构独立增员甲';
const checks = [
  { id: 'mismatched-person', personId: '785', selectedDisplayName: fictionalName,
    confirmed: true, expected: 'Selected Person changed; resolve identity again' },
  { id: 'missing-human-confirmation', personId: '784', selectedDisplayName: fictionalName,
    confirmed: false, expected: 'Human confirmation is required' },
  { id: 'duplicate-speaker', personId: '784', selectedDisplayName: fictionalName,
    confirmed: true, expected: 'Speaker profile already exists for this Person' },
];

async function probe(nonce, checks) {
  const view = document.getElementById('view');
  const records = [];
  try {
    await initSdk();
    await ensureSession();
    if (!(await authInst.getSession())?.data?.session) throw Error('NO_SESSION');
    for (const check of checks) {
      view.textContent = `PC36 身份拒绝核查 / Identity rejection check: ${check.id}`;
      const at = performance.now();
      try {
        const response = await Promise.race([
          callFn('person_360', { action: 'createSpeakerProfile', data: {
            personId: check.personId, selectedDisplayName: check.selectedDisplayName,
            confirmed: check.confirmed, profile: {},
          } }),
          new Promise((_, reject) => setTimeout(() => reject(Error('TIMEOUT')), 30000)),
        ]);
        records.push({ id: check.id, status: response?.error === check.expected ? 'PASS' : 'FAIL',
          ms: Math.round(performance.now() - at) });
      } catch {
        records.push({ id: check.id, status: 'FAIL', ms: Math.round(performance.now() - at) });
      }
      if (records.at(-1).status !== 'PASS') break;
    }
  } catch {
    records.push({ id: 'login', status: 'FAIL', ms: 0 });
  }
  try {
    const saved = await fetch('/result', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Probe-Nonce': nonce,
    }, body: JSON.stringify({ records }) });
    view.textContent = saved.ok
      ? 'PC36 身份拒绝核查已保存，请等待数据读回。 / Rejection checks saved; awaiting data readback.'
      : '保存结果失败。 / Could not save results.';
  } catch { view.textContent = '保存结果失败。 / Could not save results.'; }
  try { await authInst.signOut(); } catch { view.textContent += ' 请关闭窗口。 / Please close this window.'; }
}

const html = '<!doctype html><meta charset="utf-8"><title>PC36 身份拒绝核查</title>' +
  '<style>body{font:16px sans-serif;max-width:760px;margin:48px auto}input,button{padding:12px;margin:8px}</style>' +
  '<h1>PC36 身份拒绝核查 / Identity rejection check</h1>' +
  '<p>请登录 CRM。仅对已有嘉宾的“勿联系”虚构人物发送三次预期被拒绝的创建请求；不调用 AI。结果只保存通过/失败和耗时，随后退出测试会话。</p>' +
  '<div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div>' +
  '<script src="' + sdk + '"></script><script>var CONFIG={envId:' + JSON.stringify(envId) + '};' +
  'var app=null;function route(){}' + source.slice(start, end) +
  '\n(' + probe.toString() + ')(' + JSON.stringify(nonce) + ',' + JSON.stringify(checks) + ');</script>';

const allowed = new Set([...checks.map(x => x.id), 'login']);
let origin;
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  if (req.method !== 'POST' || req.url !== '/result' || req.headers.origin !== origin ||
    req.headers['x-probe-nonce'] !== nonce) { res.writeHead(403); res.end(); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 10000) req.destroy(); });
  req.on('end', () => {
    try {
      const input = JSON.parse(body);
      if (!Array.isArray(input.records) || input.records.length > checks.length + 1) throw Error('Invalid summary');
      const rows = input.records.map(row => {
        if (!allowed.has(row.id) || !['PASS', 'FAIL'].includes(row.status) ||
          !Number.isFinite(row.ms) || row.ms < 0) throw Error('Invalid result');
        return { id: row.id, status: row.status, ms: row.ms };
      });
      const report = { environment: envId, observedAt: new Date().toISOString(), records: rows };
      const dir = path.join(root, 'tests/security/.results');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'pc36-live-speaker-reject.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report));
      res.end('ok');
      setTimeout(() => server.close(), 1000);
    } catch { res.writeHead(400); res.end('Invalid summary'); }
  });
});
server.listen(0, '127.0.0.1', () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  console.log('PC36 login: ' + origin);
  const browser = spawn(process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--new-window', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'crm-pc36-speaker-')), origin],
    { stdio: 'ignore', detached: true });
  browser.on('error', () => { server.close(); process.exitCode = 1; });
  browser.unref();
});
