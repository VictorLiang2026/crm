'use strict';
// Reuse one already human-confirmed fictional Quick Capture command. The caller must
// compare public interactions/context_items counts before and after this probe.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');

const previewId = process.argv[2];
const personId = process.argv[3];
const interactionId = process.argv[4];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previewId || '') ||
  !/^[1-9]\d*$/.test(personId || '') || !/^[1-9]\d*$/.test(interactionId || '')) {
  throw Error('Expected: node live-capture-replay.cjs <confirmed-preview-id> <person-id> <interaction-id>');
}
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const start = source.indexOf('var authInst = null;');
const end = source.indexOf('// ==================== 表单生成');
const sdk = source.match(/https:\/\/static\.cloudbase\.net\/cloudbase-js-sdk\/\d+\.\d+\.\d+\/cloudbase\.full\.js/)?.[0];
if (start < 0 || end <= start || !sdk) throw Error('CRM login source anchors changed');

const envId = 'crm-d1gkae8ddc930d151';
const nonce = crypto.randomBytes(24).toString('hex');

async function probe(nonce, previewId, personId, interactionId) {
  const view = document.getElementById('view');
  let record = { id: 'login', status: 'FAIL', ms: 0 };
  try {
    await initSdk();
    await ensureSession();
    if (!(await authInst.getSession())?.data?.session) throw Error('NO_SESSION');
    view.textContent = 'PC36 已确认命令重放核查 / Confirmed command replay check';
    const at = performance.now();
    try {
      const response = await Promise.race([
        callFn('person_360', { action: 'executeIdentity', data: { previewId } }),
        new Promise((_, reject) => setTimeout(() => reject(Error('TIMEOUT')), 30000)),
      ]);
      const personMatches = String(response?.personId) === personId;
      const interactionMatches = String(response?.interactionId) === interactionId;
      const countMatches = Number(response?.contextItemCount) === 2;
      const error = String(response?.error || '');
      const reason = error.includes('Preview not found for this account') ? 'ACTOR_MISMATCH'
        : error === 'UNAUTHORIZED' ? 'UNAUTHORIZED'
          : error.includes('Preview expired') ? 'EXPIRED'
            : error ? 'SERVER_ERROR'
              : !response ? 'MISSING_RESPONSE' : 'SHAPE_MISMATCH';
      record = { id: 'same-confirmed-capture',
        status: !error && personMatches && interactionMatches && countMatches ? 'PASS' : 'FAIL',
        reason: !error && personMatches && interactionMatches && countMatches ? 'MATCH' : reason,
        personMatches, interactionMatches, countMatches,
        ms: Math.round(performance.now() - at) };
    } catch {
      record = { id: 'same-confirmed-capture', status: 'FAIL', reason: 'TRANSPORT_ERROR',
        personMatches: false, interactionMatches: false, countMatches: false,
        ms: Math.round(performance.now() - at) };
    }
  } catch { /* Only the fixed status summary leaves this browser. */ }
  try {
    const saved = await fetch('/result', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Probe-Nonce': nonce,
    }, body: JSON.stringify({ record }) });
    view.textContent = saved.ok
      ? '重放结果已保存，请等待数据库核对。 / Replay result saved; awaiting database check.'
      : '保存结果失败。 / Could not save result.';
  } catch { view.textContent = '保存结果失败。 / Could not save result.'; }
  try { await authInst.signOut(); } catch { view.textContent += ' 请关闭窗口。 / Please close this window.'; }
}

const html = '<!doctype html><meta charset="utf-8"><title>PC36 快速记录重放核查</title>' +
  '<style>body{font:16px sans-serif;max-width:760px;margin:48px auto}input,button{padding:12px;margin:8px}</style>' +
  '<h1>PC36 快速记录重放核查 / Quick Capture replay check</h1>' +
  '<p>请登录同一 CRM 测试账号。仅重放刚才人工确认的虚构快速记录命令；预期返回原 ID，不创建新互动、事实或信号。不保存凭据或业务正文。</p>' +
  '<div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div>' +
  '<script src="' + sdk + '"></script><script>var CONFIG={envId:' + JSON.stringify(envId) + '};' +
  'var app=null;function route(){}' + source.slice(start, end) +
  '\n(' + probe.toString() + ')(' + JSON.stringify(nonce) + ',' + JSON.stringify(previewId) + ',' +
  JSON.stringify(personId) + ',' + JSON.stringify(interactionId) + ');</script>';

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
      const record = input.record;
      if (!record || !['login', 'same-confirmed-capture'].includes(record.id) ||
        !['PASS', 'FAIL'].includes(record.status) || !Number.isFinite(record.ms) || record.ms < 0 ||
        (record.reason && !['MATCH', 'ACTOR_MISMATCH', 'UNAUTHORIZED', 'EXPIRED', 'SERVER_ERROR',
          'MISSING_RESPONSE', 'SHAPE_MISMATCH', 'TRANSPORT_ERROR'].includes(record.reason)) ||
        ['personMatches', 'interactionMatches', 'countMatches'].some(key =>
          record[key] !== undefined && typeof record[key] !== 'boolean')) {
        throw Error('Invalid summary');
      }
      const report = { environment: envId, observedAt: new Date().toISOString(), record };
      const dir = path.join(root, 'tests/security/.results');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'pc36-live-capture-replay.json'), JSON.stringify(report, null, 2) + '\n');
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
      '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'crm-pc36-capture-')), origin],
    { stdio: 'ignore', detached: true });
  browser.on('error', () => { server.close(); process.exitCode = 1; });
  browser.unref();
});
