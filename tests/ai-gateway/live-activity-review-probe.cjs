'use strict';
// Interactive production probe. Credentials remain in the isolated browser; report contains counts only.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-activity-review-probe-'));
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
    if (sessionStorage.getItem('activityReviewProbeStarted')) return;
    sessionStorage.setItem('activityReviewProbeStarted', '1');
    const response = await callFn('ai_activity', { action: 'postReviewV2', activity_id: 2 });
    const review = response?.review;
    await publish({ ready: true, ok: Boolean(review && response.requires_confirmation &&
      response.business_data_written === false),
      sections: review ? ['whoMattered','whatChanged','relationshipsImproved','signalsAppeared',
        'opportunitiesAppeared','followUpPeople'].filter(key => Array.isArray(review[key])).length : 0,
      candidates: Array.isArray(review?.actionCandidates) ? review.actionCandidates.length : null,
      taskId: Number.isSafeInteger(Number(response?.task_id)) ? Number(response.task_id) : null,
      error: typeof response?.error === 'string' ? response.error.slice(0, 120) : null });
    document.getElementById('view').textContent = '活动关系复盘验证已完成。';
  })().catch(async error => {
    await publish({ ready: true, ok: false, sections: 0, candidates: null, taskId: null,
      error: String(error?.message || error).slice(0, 120) });
    document.getElementById('view').textContent = '活动关系复盘验证未通过。';
  });
}

const html = `<!doctype html><meta charset="utf-8"><title>CRM 活动关系复盘验证</title><style>${style}</style><body><h2>CRM 活动关系复盘验证</h2><p>登录测试账号后仅运行一次复盘预览；结果仅报告数量，不保存业务数据。</p><div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div><script src="https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js"></script><script>var CONFIG={envId:'crm-d1gkae8ddc930d151'};var app=null;function route(){};${loginSource}\n(${probe.toString()})();</script>`;
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
    request.on('data', part => { body += part; if (body.length > 1500) request.destroy(); });
    request.on('end', () => {
      try {
        const value = JSON.parse(body);
        if (Object.keys(value).some(key => !['ready','ok','sections','candidates','taskId','error'].includes(key))) throw new Error('Unsafe report');
        status = value;
        fs.writeFileSync(path.join(reportDir, 'result.json'), JSON.stringify(value, null, 2));
        response.end('ok');
      } catch { response.writeHead(400); response.end('Invalid report'); }
    });
    return;
  }
  response.writeHead(404); response.end();
});
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-activity-review-login-'));
  const executable = process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = spawn(executable, ['--no-first-run','--no-default-browser-check','--disable-sync',
    `--user-data-dir=${profile}`, `--app=${url}`], { windowsHide: false, stdio: 'ignore' });
  browser.on('error', error => { console.error(error.message); server.close(); });
  process.on('SIGINT', () => { browser.kill(); server.close(() => process.exit(0)); });
  console.log(`Activity review probe: ${url}`);
});
