'use strict';
// Interactive, read-only production probe. The test account signs in inside its own browser profile.
// Only section names and a pass/fail flag return to the local server; no CRM rows are transmitted.
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
    if (sessionStorage.getItem('morningBriefProbeDone')) return;
    sessionStorage.setItem('morningBriefProbeDone', '1');
    const result = await callFn('today_coach', { action: 'daily_review', view: 'morning' });
    if (result?.error) throw new Error(String(result.error).slice(0, 60));
    const expected = ['morningBrief','topActions','commitments','upcoming','risk',
      'opportunities','needConfirmation'];
    const sections = result?.sections || {};
    const ok = result?.view === 'morning' && expected.every(key => Object.hasOwn(sections, key)) &&
      Array.isArray(sections.topActions) && Array.isArray(sections.opportunities) &&
      Array.isArray(sections.needConfirmation);
    await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ready: true, ok, sections: expected.filter(key => Object.hasOwn(sections, key)),
        guidanceSource: sections.morningBrief?.guidanceSource || '' }) });
    document.getElementById('view').textContent = ok ?
      '晨间简报线上只读验证通过。' : '晨间简报线上验证未通过。';
  })().catch(async error => {
    await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ready: true, ok: false, error: String(error?.message || error).slice(0, 80) }) });
    document.getElementById('view').textContent = '晨间简报线上验证未通过。';
  });
}
const html = `<!doctype html><meta charset="utf-8"><title>CRM 晨间简报只读验证</title><style>${style}</style><body><h2>CRM 晨间简报只读验证</h2><p>登录测试账号后读取一次七段晨间简报；不会创建或修改业务记录。</p><div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div><script src="https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js"></script><script>var CONFIG={envId:'crm-d1gkae8ddc930d151'};var app=null;function route(){};${loginSource}\n(${probe.toString()})();</script>`;
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
        if (Object.keys(value).some(key => !['ready','ok','sections','guidanceSource','error'].includes(key)) ||
            (value.sections && (!Array.isArray(value.sections) || value.sections.length > 7))) throw new Error('Unsafe report');
        status = value; response.end('ok');
      } catch { response.writeHead(400); response.end('Invalid report'); }
    });
    return;
  }
  response.writeHead(404); response.end();
});
server.listen(Number(process.env.CRM_TEST_PORT || 0), '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = process.env.CRM_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'crm-morning-login-'));
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--no-first-run','--no-default-browser-check','--disable-sync',
      `--user-data-dir=${profile}`,`--app=${url}`], { windowsHide: false, stdio: 'ignore' });
  browser.on('error', error => { console.error(error.message); server.close(); });
  process.on('SIGINT', () => { browser.kill(); server.close(() => process.exit(0)); });
  console.log(`CRM Morning Brief probe: ${url}`);
});
