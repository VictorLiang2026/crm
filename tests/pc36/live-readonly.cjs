'use strict';
// Authenticated, read-only PC36 route probe. Credentials and CRM rows stay in the browser.
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
const checks = [
  ['people', 'person_360', { action: 'listPeople', page: 1, pageSize: 1 }],
  ['person', 'person_360', { action: 'get', personId: '783' }],
  ['timeline', 'person_360', { action: 'getTimelinePage', personId: '783', page: 1, pageSize: 20 }],
  ['work', 'person_360', { action: 'listPersonWorkItems', personId: '783' }],
  ['context', 'person_360', { action: 'getContextGroups', personId: '783' }],
  ['insurance', 'person_360', { action: 'getInsuranceContext', personId: '783' }],
  ['relationships', 'person_360', { action: 'listRelationships', personId: '783' }],
  ['network', 'person_360', { action: 'listRelationshipNetwork', personId: '783', page: 1 }],
  ['recruit', 'person_360', { action: 'listRecruitDirectory', page: 1, pageSize: 30 }],
  ['opportunities', 'person_360', { action: 'listOpportunityDirectory', page: 1, pageSize: 20 }],
  ['activities', 'activities', { action: 'list' }],
  ['person-trash', 'person_360', { action: 'listPersonTrash', page: 1, pageSize: 20 }],
  ['customer-trash', 'customers', { action: 'trashList', page: 1, pageSize: 20 }],
  ['recruit-trash', 'recruit_candidates', { action: 'trashList', page: 1, pageSize: 20 }],
  ['legacy-customers', 'customers', { action: 'list', page: 1, pageSize: 20 }],
  ['legacy-recruit', 'recruit_candidates', { action: 'list', page: 1, pageSize: 30 }],
  ['ai-history', 'assistant', { action: 'personAIHistory', personId: '783' }],
  ['knowledge', 'person_360', { action: 'listKnowledgeGovernance' }],
  ['proactive', 'person_360', { action: 'listProactiveCoachCandidates' }],
  ['customer-report', 'activity_reports', { action: 'customer', mode: 'today' }],
  ['recruit-report', 'activity_reports', { action: 'recruit', mode: 'today' }],
];

async function probe(nonce, checks) {
  const view = document.getElementById('view');
  const records = [];
  try {
    await initSdk();
    await ensureSession();
    if (!(await authInst.getSession())?.data?.session) throw Error('NO_SESSION');
    for (const [id, fn, args] of checks) {
      view.textContent = `PC36 只读核查 / Read-only check: ${id}`;
      const at = performance.now();
      try {
        const response = await Promise.race([
          callFn(fn, args),
          new Promise((_, reject) => setTimeout(() => reject(Error('TIMEOUT')), 30000)),
        ]);
        if (!response || response.error || response.ok === false) throw Error('FUNCTION_ERROR');
        records.push({ id, status: 'PASS', ms: Math.round(performance.now() - at) });
      } catch {
        records.push({ id, status: 'FAIL', ms: Math.round(performance.now() - at) });
      }
    }
  } catch {
    records.push({ id: 'login', status: 'FAIL', ms: 0 });
  }
  try {
    const saved = await fetch('/result', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Probe-Nonce': nonce,
    }, body: JSON.stringify({ records }) });
    view.textContent = saved.ok
      ? 'PC36 只读核查已保存，可以关闭窗口。 / Read-only results saved. You may close this window.'
      : '保存结果失败。 / Could not save results.';
  } catch { view.textContent = '保存结果失败。 / Could not save results.'; }
  try { await authInst.signOut(); } catch { view.textContent += ' 请关闭窗口。 / Please close this window.'; }
}

const html = '<!doctype html><meta charset="utf-8"><title>PC36 只读集成核查</title>' +
  '<style>body{font:16px sans-serif;max-width:760px;margin:48px auto}input,button{padding:12px;margin:8px}</style>' +
  '<h1>PC36 只读集成核查 / Read-only integration check</h1>' +
  '<p>请登录 CRM。仅查询已登记的虚构 Person #783 和列表；不写业务数据、不调用 AI 模型、不保存凭据或记录正文。</p>' +
  '<div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div>' +
  '<script src="' + sdk + '"></script><script>var CONFIG={envId:' + JSON.stringify(envId) + '};' +
  'var app=null;function route(){}' + source.slice(start, end) +
  '\n(' + probe.toString() + ')(' + JSON.stringify(nonce) + ',' + JSON.stringify(checks) + ');</script>';

const allowed = new Set([...checks.map(x => x[0]), 'login']);
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
      fs.writeFileSync(path.join(dir, 'pc36-live-readonly.json'), JSON.stringify(report, null, 2) + '\n');
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
      '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'crm-pc36-')), origin],
    { stdio: 'ignore', detached: true });
  browser.on('error', () => { server.close(); process.exitCode = 1; });
  browser.unref();
});
