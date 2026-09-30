'use strict';
// Interactive non-writing probe. Credentials remain in the browser; only error codes return locally.
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
  (async () => {
    if (!await initSdk()) throw new Error('LOGIN_FAILED');
    if (sessionStorage.getItem('assistantActionProbeDone')) return;
    sessionStorage.setItem('assistantActionProbeDone', '1');
    const direct = await callFn('assistant', { action: 'create', query: '直接创建行动' });
    const invalidPerson = await callFn('assistant', { action: 'command', stage: 'plan', command: {
      operation: 'create', resource: 'actions', personId: 999999999,
      changes: { action_type: 'followup', title: '[CRM_TEST_ONLY] 不创建行动' },
    } });
    const unconfirmed = await callFn('assistant', { action: 'command', stage: 'execute',
      resource: 'actions', commandId: '11111111-1111-4111-8111-111111111111' });
    const codes = [direct?.error?.code, invalidPerson?.error?.code, unconfirmed?.error?.code];
    const ok = codes[0] === 'COMMAND_PLAN_REQUIRED' && codes[1] === 'INVALID_COMMAND' &&
      codes[2] === 'CONFIRMATION_REQUIRED';
    await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ready: true, ok, codes }) });
    document.getElementById('view').textContent = ok ? 'Action 创建安全验证通过。' : 'Action 创建安全验证未通过。';
  })().catch(async error => {
    await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ready: true, ok: false, codes: [String(error?.message || error).slice(0, 60)] }) });
    document.getElementById('view').textContent = 'Action 创建安全验证未通过。';
  });
}
const html = `<!doctype html><meta charset="utf-8"><title>CRM Action 安全验证</title><style>${style}</style><body><h2>CRM Action 安全验证</h2><p>登录测试账号后，仅验证无效 Person 与未经确认的执行请求会被拒绝；不会创建行动。</p><div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div><script src="https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js"></script><script>var CONFIG={envId:'crm-d1gkae8ddc930d151'};var app=null;function route(){};${loginSource}\n(${probe.toString()})();</script>`;
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
        if (Object.keys(value).some(key => !['ready','ok','codes'].includes(key)) ||
            !Array.isArray(value.codes) || value.codes.length > 3) throw new Error('Unsafe report');
        status = value; response.end('ok');
      } catch { response.writeHead(400); response.end('Invalid report'); }
    });
    return;
  }
  response.writeHead(404); response.end();
});
server.listen(Number(process.env.CRM_TEST_PORT || 0), '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = process.env.CRM_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'crm-action-login-'));
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--no-first-run','--no-default-browser-check','--disable-sync',
      `--user-data-dir=${profile}`,`--app=${url}`], { windowsHide: false, stdio: 'ignore' });
  browser.on('error', error => { console.error(error.message); server.close(); });
  process.on('SIGINT', () => { browser.kill(); server.close(() => process.exit(0)); });
  console.log(`CRM Action probe: ${url}`);
});
