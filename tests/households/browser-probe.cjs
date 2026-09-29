'use strict';
// Interactive read-only probe: the operator enters credentials in the browser, never in this process.
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

function probe(personId) {
  const publish = data => fetch('/result', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  (async () => {
    if (!await initSdk()) throw new Error('SDK initialization failed');
    const response = await callFn('person_360', { action: 'get', personId });
    const opportunities = await callFn('person_360', { action: 'listOpportunities', personId });
    const insurance = await callFn('person_360', { action: 'getInsuranceContext', personId });
    const recruit = await callFn('person_360', { action: 'listRecruitContext', personId });
    const interactions = await callFn('person_360', { action: 'listInteractions', personId, limit: 20 });
    await publish({ ready: true, hasPerson: Boolean(response?.person?.id),
      householdCount: response?.household ? 1 : 0,
      memberCount: Array.isArray(response?.members) ? response.members.length : null,
      opportunityCount: Array.isArray(opportunities?.rows) ? opportunities.rows.length : null,
      insuranceReady: Array.isArray(insurance?.existingCoverage) &&
        Array.isArray(insurance?.openOpportunities) && Array.isArray(insurance?.nextActions),
      candidateCount: Array.isArray(recruit?.rows) ? recruit.rows.length : null,
      recentRecruitFollowupCount: Array.isArray(recruit?.rows) ? recruit.rows.reduce((count, row) =>
        count + (Array.isArray(row.recentFollowups) ? row.recentFollowups.length : 0), 0) : null,
      mappedRecruitInteractionCount: Array.isArray(interactions?.rows) ? interactions.rows.filter(row =>
        row.source_type === 'recruit_followups').length : null,
      error: typeof (response?.error || opportunities?.error || insurance?.error || recruit?.error || interactions?.error) === 'string'
        ? (response.error || opportunities.error || insurance.error || recruit.error || interactions.error).slice(0, 120) : null });
    document.getElementById('view').textContent = 'Person 360、招募、机会与保险概览只读验证完成。';
  })().catch(async error => {
    await publish({ ready: true, hasPerson: false, error: String(error?.message || error).slice(0, 120) });
    document.getElementById('view').textContent = 'Person 360 只读验证未通过。';
  });
}

const personId = Number(process.env.CRM_RECRUIT_PROBE_PERSON_ID || 1);
if (!Number.isSafeInteger(personId) || personId < 1) throw new Error('Invalid probe Person ID');
const html = `<!doctype html><meta charset="utf-8"><title>CRM Person 360 验证</title><style>${style}</style><body><h2>CRM Person 360 只读验证</h2><div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div><script src="https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js"></script><script>var CONFIG={envId:'crm-d1gkae8ddc930d151'};var app=null;function route(){};${loginSource}\n(${probe.toString()})(${personId});</script>`;
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
        if (Object.keys(value).some(key => !['ready','hasPerson','householdCount','memberCount','opportunityCount','insuranceReady','candidateCount','recentRecruitFollowupCount','mappedRecruitInteractionCount','error'].includes(key))) throw new Error('Unsafe report');
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-person360-'));
  const exe = process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const child = spawn(exe, ['--no-first-run','--no-default-browser-check','--disable-sync',
    `--user-data-dir=${profile}`, `--app=${url}`], { windowsHide: false, stdio: 'ignore' });
  child.on('error', error => { console.error(error.message); server.close(); });
  process.on('SIGINT', () => { child.kill(); server.close(() => process.exit(0)); });
  console.log(`Person 360 browser probe ready: ${url}`);
});
