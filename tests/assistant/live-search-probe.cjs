'use strict';
// Interactive production probe. Credentials stay in an isolated browser; only status and counts return locally.
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
  async function publish(data) {
    await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data) });
  }
  (async () => {
    if (!await initSdk()) throw new Error('LOGIN_FAILED');
    if (sessionStorage.getItem('crmSearchProbeStarted')) return;
    sessionStorage.setItem('crmSearchProbeStarted', '1');
    const legacy = await callFn('assistant', {
      intent: 'search', input: { query: '[CRM_TEST_ONLY] route probe' },
    });
    const result = await callFn('assistant', {
      action: 'search', query: '最近三个月参加过活动但没有继续跟进的人',
    });
    const ok = legacy?.ok === true && legacy?.execution?.performed === false &&
      result?.ok === true && result?.status === 'complete' &&
      result?.criteria?.template === 'activity_no_followup' &&
      Array.isArray(result.rows) && result.total >= result.rows.length &&
      result.resultSource === 'public.crm_search_people_v1' &&
      result.execution?.businessDataWritten === false;
    await publish({ ready: true, ok, oldRouteOk: legacy?.ok === true,
      template: result?.criteria?.template || null,
      total: Number.isSafeInteger(result?.total) ? result.total : null,
      rows: Array.isArray(result?.rows) ? result.rows.length : null,
      error: typeof result?.error?.code === 'string' ? result.error.code.slice(0, 60) : null });
    document.getElementById('view').textContent = ok ? 'AI CRM 搜索验证通过。' : 'AI CRM 搜索验证未通过。';
  })().catch(async error => {
    await publish({ ready: true, ok: false, oldRouteOk: false, template: null,
      total: null, rows: null, error: String(error?.message || error).slice(0, 100) });
    document.getElementById('view').textContent = 'AI CRM 搜索验证未通过。';
  });
}

const html = `<!doctype html><meta charset="utf-8"><title>CRM 搜索验证</title><style>${style}</style><body><h2>AI CRM 搜索验证</h2><p>使用测试账号登录后，只执行一次只读搜索；本地仅记录模板与数量，不传回姓名或客户资料。</p><div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div><script src="https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js"></script><script>var CONFIG={envId:'crm-d1gkae8ddc930d151'};var app=null;function route(){};${loginSource}\n(${probe.toString()})();</script>`;
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
    request.on('data', part => { body += part; if (body.length > 600) request.destroy(); });
    request.on('end', () => {
      try {
        const value = JSON.parse(body);
        if (Object.keys(value).some(key => !['ready','ok','oldRouteOk','template','total','rows','error'].includes(key))) {
          throw new Error('Unsafe report');
        }
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-search-login-'));
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--no-first-run', '--no-default-browser-check', '--disable-sync',
      `--user-data-dir=${profile}`, `--app=${url}`], { windowsHide: false, stdio: 'ignore' });
  browser.on('error', error => { console.error(error.message); server.close(); });
  process.on('SIGINT', () => { browser.kill(); server.close(() => process.exit(0)); });
  console.log(`CRM search probe: ${url}`);
});
