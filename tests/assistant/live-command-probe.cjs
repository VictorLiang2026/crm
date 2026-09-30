'use strict';
// Interactive read-free probe. Credentials stay in the browser; only booleans and error codes return locally.
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
    if (sessionStorage.getItem('assistantCommandProbeFinal')) return;
    sessionStorage.setItem('assistantCommandProbeFinal', '1');
    const legacy = await callFn('assistant', { intent: 'search', input: { query: '[CRM_TEST_ONLY] route probe' } });
    const direct = await callFn('assistant', { action: 'delete', query: '删除客户', confirmed: true });
    const planned = await callFn('assistant', { action: 'command', stage: 'plan',
      command: { operation: 'delete', resource: 'actions', targetId: 7 } });
    const confirm = await callFn('assistant', { action: 'command', stage: 'confirm',
      planId: 'forged', confirmed: true, previewVerified: true });
    const execute = await callFn('assistant', { action: 'command', stage: 'execute',
      planId: 'forged', confirmed: true, previewVerified: true });
    const codes = [direct?.error?.code, confirm?.error?.code, execute?.error?.code];
    const ok = legacy?.ok === true && legacy.execution?.performed === false &&
      planned?.ok === true && planned.plan?.executable === false &&
      planned.execution?.businessDataWritten === false &&
      codes[0] === 'COMMAND_PLAN_REQUIRED' &&
      codes[1] === 'SERVER_CONFIRMATION_REQUIRED' &&
      codes[2] === 'EXECUTOR_NOT_ENABLED';
    await publish({ ready: true, ok, oldRouteOk: legacy?.ok === true,
      planNonExecutable: planned?.plan?.executable === false, codes });
    document.getElementById('view').textContent = ok ? 'Assistant 命令安全验证通过。' : 'Assistant 命令安全验证未通过。';
  })().catch(async error => {
    await publish({ ready: true, ok: false, oldRouteOk: false,
      planNonExecutable: false, codes: [String(error?.message || error).slice(0, 80)] });
    document.getElementById('view').textContent = 'Assistant 命令安全验证未通过。';
  });
}

const html = `<!doctype html><meta charset="utf-8"><title>CRM 命令安全验证</title><style>${style}</style><body><h2>Assistant 命令安全验证</h2><p>登录测试账号后，只验证计划与拒绝执行；不会读取或修改客户资料。</p><div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div><script src="https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js"></script><script>var CONFIG={envId:'crm-d1gkae8ddc930d151'};var app=null;function route(){};${loginSource}\n(${probe.toString()})();</script>`;
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
        if (Object.keys(value).some(key => !['ready', 'ok', 'oldRouteOk', 'planNonExecutable', 'codes'].includes(key)) ||
            !Array.isArray(value.codes) || value.codes.length > 3) throw new Error('Unsafe report');
        status = value;
        response.end('ok');
      } catch { response.writeHead(400); response.end('Invalid report'); }
    });
    return;
  }
  response.writeHead(404); response.end();
});
server.listen(Number(process.env.CRM_TEST_PORT || 0), '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = process.env.CRM_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'crm-command-login-'));
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--no-first-run', '--no-default-browser-check', '--disable-sync',
      `--user-data-dir=${profile}`, `--app=${url}`], { windowsHide: false, stdio: 'ignore' });
  browser.on('error', error => { console.error(error.message); server.close(); });
  process.on('SIGINT', () => { browser.kill(); server.close(() => process.exit(0)); });
  console.log(`CRM command probe: ${url}`);
});
