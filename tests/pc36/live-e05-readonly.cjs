'use strict';
// Production read-only checks for one human-reviewed fictional relationship.
// Browser credentials and response bodies are never written to disk.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');

const edgeId = process.argv[2];
const phase = process.argv[3];
if (!/^[1-9]\d*$/.test(edgeId || '') ||
  !['pending', 'confirmed', 'unlinked', 'restored'].includes(phase)) {
  throw Error('Expected fictional relationship ID and phase');
}
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const start = source.indexOf('var authInst = null;');
const end = source.indexOf('// ==================== 表单生成');
const sdk = source.match(/https:\/\/static\.cloudbase\.net\/cloudbase-js-sdk\/\d+\.\d+\.\d+\/cloudbase\.full\.js/)?.[0];
if (start < 0 || end <= start || !sdk) throw Error('CRM login source anchors changed');
const envId = 'crm-d1gkae8ddc930d151';
const nonce = crypto.randomBytes(24).toString('hex');

async function probe(nonce, edgeId, phase) {
  const view = document.getElementById('view');
  const records = [];
  const visible = phase === 'confirmed' || phase === 'restored';
  const absent = value => !value;
  const hasEdge = rows => rows?.some(row => String(row.id || row.source?.id) === edgeId);
  const checks = [
    ['relationship-state', 'listRelationships',
      { personId: '784', includeDeleted: true }, value => {
        const row = value?.rows?.find(item => String(item.id) === edgeId);
        return row && String(row.from_person_id) === '784' && String(row.to_person_id) === '785' &&
          row.relationship_type === 'friend' &&
          (phase === 'unlinked' ? Boolean(row.deleted_at) :
            row.deleted_at == null && row.status === (phase === 'pending' ? 'pending' : 'confirmed'));
      }],
    ['network-filter', 'listRelationshipNetwork',
      { personId: '784', page: 1 }, value =>
        visible ? hasEdge(value?.adjacency?.rows) : absent(hasEdge(value?.adjacency?.rows))],
    ['family-separated', 'listRelationshipNetwork',
      { personId: '784', page: 1 }, value =>
        !value?.family?.rows?.some(row => String(row.personId) === '785')],
    ['path-filter', 'listRelationshipIntroductionPaths',
      { personId: '784' }, value =>
        visible
          ? value?.paths?.some(row => String(row.targetPersonId) === '785' &&
              row.hops?.some(hop => String(hop.edgeId) === edgeId))
          : !value?.paths?.some(row => row.hops?.some(hop => String(hop.edgeId) === edgeId))],
    ['ai-context-filter', 'getMeetingPrepContext',
      { personId: '784' }, value =>
        visible ? hasEdge(value?.relationship) : absent(hasEdge(value?.relationship))],
  ];
  try {
    await initSdk();
    await ensureSession();
    if (!(await authInst.getSession())?.data?.session) throw Error('NO_SESSION');
    for (const [id, action, data, valid] of checks) {
      view.textContent = `PC36 E05 只读核查 / Read-only check: ${id}`;
      const at = performance.now();
      try {
        const result = await Promise.race([
          callFn('person_360', { action, ...data }),
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

const html = '<!doctype html><meta charset="utf-8"><title>PC36 E05 只读核查</title>' +
  '<style>body{font:16px sans-serif;max-width:760px;margin:48px auto}input,button{padding:12px;margin:8px}</style>' +
  '<h1>PC36 E05 只读核查 / Read-only integration check</h1>' +
  '<p>请登录 CRM。仅查询已登记的虚构 Person #784/#785 及指定关系；不写业务数据、不调用模型、不保存凭据或正文。</p>' +
  '<div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div>' +
  '<script src="' + sdk + '"></script><script>var CONFIG={envId:' + JSON.stringify(envId) + '};' +
  'var app=null;function route(){}' + source.slice(start, end) +
  '\n(' + probe.toString() + ')(' + JSON.stringify(nonce) + ',' + JSON.stringify(edgeId) + ',' +
  JSON.stringify(phase) + ');</script>';

const allowed = new Set(['relationship-state', 'network-filter', 'family-separated', 'path-filter',
  'ai-context-filter', 'login']);
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
      if (!Array.isArray(records) || records.length < 1 || records.length > 5 ||
        records.some(row => !allowed.has(row.id) || !['PASS', 'FAIL'].includes(row.status) ||
          !Number.isFinite(row.ms) || row.ms < 0)) throw Error('Invalid summary');
      const report = { environment: envId, observedAt: new Date().toISOString(), phase, edgeId, records };
      const dir = path.join(root, 'tests/security/.results');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'pc36-live-e05-readonly.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report));
      res.end('ok'); setTimeout(() => server.close(), 1000);
    } catch { res.writeHead(400); res.end('Invalid summary'); }
  });
});
server.listen(0, '127.0.0.1', () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  console.log('PC36 E05 login: ' + origin);
  const browser = spawn(process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--new-window', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'crm-pc36-e05-')), origin],
    { stdio: 'ignore', detached: true });
  browser.on('error', () => { server.close(); process.exitCode = 1; });
  browser.unref();
});
