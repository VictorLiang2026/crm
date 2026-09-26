'use strict';
// Interactive read-only probe: credentials remain in the browser; only counts are saved.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const results = path.join(__dirname, '.results');
fs.mkdirSync(results, { recursive: true });
const source = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const begin = source.indexOf('var authInst = null;');
const end = source.indexOf('// ==================== 表单生成');
if (begin < 0 || end <= begin) throw new Error('CRM login source anchors changed');
const loginSource = source.slice(begin, end);
const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] || '';

function probe() {
  const publish = data => fetch('/result', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  (async () => {
    if (!await initSdk()) throw new Error('SDK initialization failed');
    const person = await callFn('person_360', { action: 'get', personId: 1 });
    const timeline = await callFn('person_360', { action: 'listInteractions', personId: 1, limit: 5 });
    const invalid = await callFn('person_360', { action: 'createInteraction', personId: 1, data: {} });
    await publish({ ready: true, hasPerson: Boolean(person?.person?.id),
      timelineRows: Array.isArray(timeline?.rows) ? timeline.rows.length : null,
      hasLegacy: Array.isArray(timeline?.rows) && timeline.rows.some(row => row.virtual === true),
      invalidWriteRejected: invalid?.error === 'Invalid interaction data',
      error: typeof timeline?.error === 'string' ? timeline.error.slice(0, 120) :
        typeof person?.error === 'string' ? person.error.slice(0, 120) : null });
    document.getElementById('view').textContent = '互动时间线只读验证完成。';
  })().catch(async error => {
    await publish({ ready: true, hasPerson: false, error: String(error?.message || error).slice(0, 120) });
    document.getElementById('view').textContent = '互动时间线只读验证未通过。';
  });
}

const html = `<!doctype html><meta charset="utf-8"><title>CRM 互动验证</title><style>${style}</style><body><h2>CRM 互动时间线只读验证</h2><div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div><script src="https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js"></script><script>var CONFIG={envId:'crm-d1gkae8ddc930d151'};var app=null;function route(){};${loginSource}\n(${probe.toString()})();</script>`;
let status = { ready: false };
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;
  }
  if (req.method === 'GET' && req.url === '/status') {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(status)); return;
  }
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', part => { body += part; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      try {
        const value = JSON.parse(body);
        if (Object.keys(value).some(key => !['ready','hasPerson','timelineRows','hasLegacy','invalidWriteRejected','error'].includes(key))) throw new Error('Unsafe report');
        status = value;
        fs.writeFileSync(path.join(results, 'latest.json'), JSON.stringify(value, null, 2));
        res.end('ok');
      } catch { res.writeHead(400); res.end('Invalid report'); }
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  fs.writeFileSync(path.join(results, 'server.json'), JSON.stringify({ url, pid: process.pid }));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-interactions-'));
  const exe = process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const child = spawn(exe, ['--no-first-run','--no-default-browser-check','--disable-sync',
    `--user-data-dir=${profile}`, `--app=${url}`], { windowsHide: false, stdio: 'ignore' });
  child.on('error', error => { console.error(error.message); server.close(); });
  process.on('SIGINT', () => { child.kill(); server.close(() => process.exit(0)); });
  console.log(`Interaction browser probe ready: ${url}`);
});
