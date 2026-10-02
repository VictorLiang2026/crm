'use strict';
// Dedicated interactive profile; no business route, write, AI, or fixture creation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'tests/security/.results');
const source = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const start = source.indexOf('var authInst = null;');
const end = source.indexOf('// ==================== 表单生成');
const sdk = source.match(/https:\/\/static\.cloudbase\.net\/cloudbase-js-sdk\/\d+\.\d+\.\d+\/cloudbase.full.js/)?.[0];
if (start < 0 || end <= start || !sdk) throw Error('Login/SDK anchors changed');
const envId = 'crm-d1gkae8ddc930d151';
const relations = require('../security/expected-public-baseline.json').objects.filter(x => x.kind === 'relation').map(x => x.name);
const nonce = crypto.randomBytes(24).toString('hex');
const marker = '【系统测试·勿联系】crm_test_wp01_' + crypto.randomUUID();
const adminHash = crypto.createHash('sha256').update(source).digest('hex');
fs.mkdirSync(dir, { recursive: true });

async function diagnostic(names, nonce, marker) {
  const results = [];
  const record = (id, status) => results.push({ id, status });
  try {
    await initSdk();
    const s = await authInst.getSession();
    const session = s?.data?.session;
    if (s.error || !session) throw Error('NO_VERIFIED_SESSION');
    record('live.login', 'PASS');
    document.getElementById('view').textContent = '正在核验只读权限，请稍候。';
    let token = session.access_token || session.accessToken;
    if (!token && typeof authInst.getAccessToken === 'function') {
      const t = await authInst.getAccessToken();
      token = typeof t === 'string' ? t : t?.accessToken || t?.access_token;
    }
    let claims;
    try { claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { /* Opaque token is not role evidence. */ }
    if (claims?.role === 'authenticated' && claims.exp * 1000 > Date.now()) {
      for (const name of names) {
        const url = 'https://crm-d1gkae8ddc930d151.api.tcloudbasegateway.com/v1/rdb/rest/' + name + '?select=*&limit=0';
        const r = await fetch(url, { method: 'HEAD', headers: { Authorization: 'Bearer ' + token,
          'Accept-Profile': 'public' }, signal: AbortSignal.timeout(15000) });
        record('authenticated.' + name, r.status === 403 ? 'PASS' : r.status === 401 ? 'UNVERIFIED' : 'FAIL');
      }
    } else record('live.authenticated', 'UNVERIFIED');
    const r = await callFn('customers', { action: 'list', keyword: marker, page: 1, pageSize: 1 });
    record('live.function.customers', !r?.error && Array.isArray(r?.rows) && r.rows.length === 0 && r.total === 0 ? 'PASS' : 'FAIL');
  } catch {
    record('live.probe', 'FAIL');
  }
  const response = await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WP01-Nonce': nonce },
    body: JSON.stringify({ results }) });
  document.getElementById('view').textContent = response.ok
    ? '验证已完成，结果已保存。可关闭窗口。' : '结果保存失败，请保留窗口。';
  try { await authInst.signOut(); } catch { document.getElementById('view').textContent += ' 请关闭测试窗口以结束会话。'; }
}
const html = '<!doctype html><meta charset="utf-8"><title>WP01 测试账号登录</title>' +
  '<style>body{font:16px sans-serif;max-width:620px;margin:48px auto}input,button{padding:12px;margin:8px}label{display:block}</style>' +
  '<h1>WP01 只读登录验证</h1><p>请使用测试账号。仅验证会话、public 权限和虚构关键词的空查询；不写业务数据。</p>' +
  '<div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div>' +
  '<script src="' + sdk + '"></script><script>var CONFIG={envId:' + JSON.stringify(envId) + '};var app=null;function route(){}' +
  source.slice(start, end) + '\n(' + diagnostic.toString() + ')(' + JSON.stringify(relations) + ',' +
  JSON.stringify(nonce) + ',' + JSON.stringify(marker) + ');</script>';
const allowed = new Set(['live.login','live.authenticated','live.function.customers','live.probe', ...relations.map(n => 'authenticated.' + n)]);
let origin;
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(html); return; }
  if (req.method !== 'POST' || req.url !== '/result' || req.headers.origin !== origin || req.headers['x-wp01-nonce'] !== nonce) {
    res.writeHead(403); res.end(); return;
  }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 20000) req.destroy(); });
  req.on('end', () => {
    try {
      const input = JSON.parse(body);
      if (!Array.isArray(input.results) || input.results.length > 52) throw Error('Invalid result');
      const results = input.results.map(r => {
        if (!allowed.has(r.id) || !['PASS','FAIL','UNVERIFIED'].includes(r.status)) throw Error('Invalid result');
        return { id: r.id, status: r.status }; // Strict whitelist; never retain arbitrary browser text.
      });
      const report = { environment: envId, observedAt: new Date().toISOString(), adminHash, results };
      fs.writeFileSync(path.join(dir, 'wp01-login.json'), JSON.stringify(report, null, 2) + '\n');
      res.end('ok'); console.log(JSON.stringify(report));
      setTimeout(() => server.close(), 1000);
    } catch { res.writeHead(400); res.end('Invalid summary'); }
  });
});
server.listen(0, '127.0.0.1', () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  const exe = process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-wp01-login-'));
  console.log('WP01 login: ' + origin);
  const browser = spawn(exe, ['--new-window','--no-first-run','--no-default-browser-check','--user-data-dir=' + profile, origin],
    { stdio: 'ignore', detached: true });
  browser.on('error', () => { console.error('Test browser failed to open'); server.close(); process.exitCode = 1; });
  browser.unref();
});
