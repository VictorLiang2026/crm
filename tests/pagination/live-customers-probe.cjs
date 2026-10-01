'use strict';
// Production read-only pagination check. Only booleans leave the browser.
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
    if (sessionStorage.getItem('customerPageProbeDone')) return;
    sessionStorage.setItem('customerPageProbeDone', '1');
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const base = { action: 'list', pageSize: 50, sortField: 'Id', sortDir: 'desc', today: date };
    const [first, second, missing, followupSort, statusSort] = await Promise.all([
      callFn('customers', { ...base, page: 1 }),
      callFn('customers', { ...base, page: 2 }),
      callFn('customers', { ...base, keyword: '[CRM_TEST_ONLY]_NO_SUCH_20261001' }),
      callFn('customers', { ...base, pageSize: 5, sortField: 'latest_followup_date' }),
      callFn('customers', { ...base, pageSize: 5, sortField: 'wb_status' }),
    ]);
    if ([first, second, missing, followupSort, statusSort].some(r => r?.error)) {
      throw new Error('CUSTOMERS_LIST_ERROR');
    }
    const ids = new Set((first.rows || []).map(row => row.Id));
    const checks = {
      pageSize: first.rows?.length === 50 && second.rows?.length <= 50,
      exactTotal: Number(first.total) === Number(second.total) && Number(first.total) >= 100,
      disjointPages: (second.rows || []).every(row => !ids.has(row.Id)),
      descendingIds: (first.rows || []).every((row, i, rows) => i === 0 || rows[i - 1].Id > row.Id),
      emptySearch: missing.total === 0 && Array.isArray(missing.rows) && missing.rows.length === 0,
      followupSort: Array.isArray(followupSort.rows) && followupSort.rows.length <= 5,
      statusSort: Array.isArray(statusSort.rows) && statusSort.rows.length <= 5,
    };
    const ok = Object.values(checks).every(Boolean);
    await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ready: true, ok, checks }) });
    document.getElementById('view').textContent = ok ? '客户分页线上只读验证通过。' : '客户分页线上验证未通过。';
  })().catch(async error => {
    sessionStorage.removeItem('customerPageProbeDone');
    await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ready: true, ok: false, error: String(error?.message || error).slice(0, 80) }) });
    document.getElementById('view').textContent = '客户分页线上验证未通过。';
  });
}
const html = `<!doctype html><meta charset="utf-8"><title>CRM 客户分页只读验证</title><style>${style}</style><body><h2>CRM 客户分页只读验证</h2><p>登录测试账号后核对客户列表分页；只读取，不创建或修改记录。</p><div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div><script src="https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js"></script><script>var CONFIG={envId:'crm-d1gkae8ddc930d151'};var app=null;function route(){};${loginSource}\n(${probe.toString()})();</script>`;
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
        if (Object.keys(value).some(key => !['ready','ok','checks','error'].includes(key)) ||
          value.checks && (Object.keys(value.checks).length !== 7 || Object.values(value.checks).some(v => typeof v !== 'boolean'))) {
          throw new Error('Unsafe report');
        }
        status = value; response.end('ok');
      } catch { response.writeHead(400); response.end('Invalid report'); }
    });
    return;
  }
  response.writeHead(404); response.end();
});
server.listen(Number(process.env.CRM_TEST_PORT || 0), '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = process.env.CRM_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'crm-customer-page-'));
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--no-first-run','--no-default-browser-check','--disable-sync',
      `--user-data-dir=${profile}`,`--app=${url}`], { windowsHide: false, stdio: 'ignore' });
  browser.on('error', error => { console.error(error.message); server.close(); });
  process.on('SIGINT', () => { browser.kill(); server.close(() => process.exit(0)); });
  console.log(`CRM customer page probe: ${url}`);
});
