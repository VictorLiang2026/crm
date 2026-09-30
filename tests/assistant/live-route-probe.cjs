'use strict';
// Interactive, read-free production probe. Credentials stay inside a fresh browser profile.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const begin = source.indexOf('var authInst = null;');
const end = source.indexOf('// ==================== 表单生成');
if (begin < 0 || end <= begin) throw new Error('CRM login source anchors changed');
const loginSource = source.slice(begin, end);
const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] || '';

function probe() {
  async function publish(result) {
    await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result) });
  }
  (async () => {
    if (!await initSdk()) throw new Error('LOGIN_FAILED');
    if (sessionStorage.getItem('assistantRouteProbeVersion') === 'v2') return;
    sessionStorage.setItem('assistantRouteProbeVersion', 'v2');
    const response = await callFn('assistant', {
      intent: 'search', input: { query: '[CRM_TEST_ONLY] route probe' },
    });
    const ok = response?.ok === true && response?.route?.key === 'search.none' &&
      response?.execution?.performed === false && response?.execution?.modelCalled === false &&
      response?.execution?.businessDataRead === false && response?.execution?.businessDataWritten === false;
    await publish({ ready: true, ok, route: response?.route?.key || null,
      error: typeof response?.error?.code === 'string' ? response.error.code.slice(0, 50) : null });
    document.getElementById('view').textContent = ok ? 'Assistant 路由验证通过。' : 'Assistant 路由验证未通过。';
  })().catch(async error => {
    await publish({ ready: true, ok: false, route: null,
      error: String(error?.message || error).slice(0, 100) });
    document.getElementById('view').textContent = 'Assistant 路由验证未通过。';
  });
}

const html = `<!doctype html><meta charset="utf-8"><title>CRM Assistant 路由验证</title><style>${style}</style><body><h2>CRM Assistant 路由验证</h2><p>登录测试账号后只验证路由结果；不会查询 CRM 数据或调用模型。</p><div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div><script src="https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js"></script><script>var CONFIG={envId:'crm-d1gkae8ddc930d151'};var app=null;function route(){};${loginSource}\n(${probe.toString()})();</script>`;
let status = { ready: false };
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'GET' && request.url === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return;
  }
  if (request.method === 'GET' && request.url === '/status') {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(status)); return;
  }
  if (request.method === 'POST' && request.url === '/result') {
    let body = '';
    request.on('data', part => { body += part; if (body.length > 500) request.destroy(); });
    request.on('end', () => {
      try {
        const value = JSON.parse(body);
        if (Object.keys(value).some(key => !['ready', 'ok', 'route', 'error'].includes(key))) throw new Error('Unsafe report');
        status = value;
        response.end('ok');
      } catch { response.writeHead(400); response.end('Invalid report'); }
    });
    return;
  }
  response.writeHead(404); response.end();
});
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = process.env.CRM_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'crm-assistant-login-'));
  const executable = process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = spawn(executable, ['--no-first-run', '--no-default-browser-check', '--disable-sync',
    `--user-data-dir=${profile}`, `--app=${url}`], { windowsHide: false, stdio: 'ignore' });
  browser.on('error', error => { console.error(error.message); server.close(); });
  process.on('SIGINT', () => { browser.kill(); server.close(() => process.exit(0)); });
  console.log(`Assistant route probe: ${url}`);
});
