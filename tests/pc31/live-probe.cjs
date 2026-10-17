'use strict';
// Interactive, read-only probe. Credentials and business rows stay in the browser.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const start = source.indexOf('var authInst = null;');
const end = source.indexOf('// ==================== 表单生成');
const sdk = source.match(/https:\/\/static\.cloudbase\.net\/cloudbase-js-sdk\/\d+\.\d+\.\d+\/cloudbase.full.js/)?.[0];
if (start < 0 || end <= start || !sdk) throw Error('Login anchors changed');
const envId = 'crm-d1gkae8ddc930d151';
const nonce = crypto.randomBytes(24).toString('hex');
const remaining = process.argv.includes('--remaining') || process.argv.includes('--opportunity-only');
const opportunityOnly = process.argv.includes('--opportunity-only');
async function probe(nonce, remaining, opportunityOnly) {
  const records = [];
  const view = document.getElementById('view');
  const invoke = async (name, args) => {
    const r = await callFn(name, args);
    if (!r || r.error || r.ok === false) throw Error('FUNCTION_ERROR');
    return r;
  };
  const p = (action, extra = {}) => invoke('person_360', { action, ...extra });
  const compare = (a, b) => {
    const ad = a.next_action_date || '', bd = b.next_action_date || '';
    if (ad !== bd) return bd.localeCompare(ad);
    const ai = BigInt(a.candidate_id), bi = BigInt(b.candidate_id);
    return ai === bi ? a.source.localeCompare(b.source) : ai > bi ? -1 : 1;
  };
  const old = async () => {
    const [l, r] = await Promise.all([
      invoke('recruit_candidates', { action: 'list', page: 1, pageSize: 1000 }),
      p('listPersonOnlyRecruits'),
    ]);
    return { rows: [...l.rows.map(x => ({ ...x, source: 'legacy' })),
      ...r.rows.map(x => ({ ...x, source: 'person' }))].sort(compare) };
  };
  const measure = async (id, fn, phase, iteration) => {
    view.textContent = `PC31 只读验证 / Read-only check: ${id} ${phase} ${iteration}`;
    const at = performance.now();
    try {
      const r = await fn();
      records.push({ id, phase, iteration, status: 'PASS', ms: Math.round(performance.now() - at),
        bytes: new TextEncoder().encode(JSON.stringify(r)).length,
        count: Array.isArray(r.rows) ? r.rows.length : 0 });
      return r;
    } catch {
      records.push({ id, phase, iteration, status: 'FAIL', ms: Math.round(performance.now() - at), bytes: 0, count: 0 });
      throw Error('PROBE_FAILED');
    }
  };
  try {
    await initSdk();
    await ensureSession();
    if (!(await authInst.getSession())?.data?.session) throw Error('NO_SESSION');
    if (!remaining) {
    // First request is labelled first-observed, never asserted to be a cold start.
    await measure('recruit.old', old, 'first', 0);
    await measure('recruit.new', () => p('listRecruitDirectory', { page: 1, pageSize: 50 }), 'first', 0);
    for (let i = 1; i <= 20; i++) {
      const jobs = [ ['recruit.old', old], ['recruit.new', () => p('listRecruitDirectory', { page: 1, pageSize: 50 })] ];
      if (i % 2 === 0) jobs.reverse();
      for (const [id, fn] of jobs) await measure(id, fn, 'warm', i);
    }
    for (let i = 1; i <= 5; i++) {
      await Promise.all(Array.from({ length: 3 }, (_, j) => measure('recruit.new',
        () => p('listRecruitDirectory', { page: 1, pageSize: 50 }), 'concurrency3', i * 3 + j)));
    }
    const before = await old();
    const all = [];
    let cursor = null;
    let finished = false;
    for (let page = 1; page <= 20; page++) {
      const r = await measure('recruit.pagination', () => p('listRecruitDirectory', { page, pageSize: 50, cursor }), 'pages', page);
      all.push(...r.rows); cursor = r.cursor;
      if (!r.hasMore) { finished = true; break; }
      if (r.truncated) break;
    }
    const after = await old();
    const fields = ['candidate_id','customer_name','stage','occupation','potential_score','next_action','next_action_date','idle_days','person_id','customer_id','source'];
    const canonical = rows => JSON.stringify(rows.map(r => fields.map(k => r[k] ?? null)));
    const unchanged = canonical(before.rows) === canonical(after.rows);
    const parity = finished && unchanged && canonical(all) === canonical(before.rows) &&
      new Set(all.map(r => `${r.source}:${r.candidate_id}`)).size === all.length;
    records.push({ id: 'recruit.parity', phase: 'assertion', iteration: 0, status: parity ? 'PASS' : 'FAIL', ms: 0, bytes: 0, count: all.length });
    }
    const routes = [
      ['people', () => p('listPeople', { page: 1, pageSize: 20 })],
      ['today', () => p('listTodayWorkItems')],
      ['opportunity', () => p('listOpportunityDirectory', { page: 1, pageSize: 20 })],
      ['activity', () => invoke('activities', { action: 'list' })],
      ['search', () => p('search', { name: '系统测试' })],
      ['funnel', () => invoke('funnel_insight', { action: 'stats' })],
      ['reports.customer', () => invoke('activity_reports', { action: 'customer', mode: 'today' })],
      ['reports.recruit', () => invoke('activity_reports', { action: 'recruit', mode: 'today' })],
    ];
    for (const [id, fn] of routes.filter(([id]) => !opportunityOnly || id === 'opportunity')) {
      try { for (let i = 0; i <= 20; i++) await measure(id, fn, i ? 'warm' : 'first', i); }
      catch { /* Preserve the FAIL and check independent read routes. */ }
    }
    const people = opportunityOnly ? {rows:[]} : await p('listPeople', {page:1,pageSize:1});
    if (people.rows?.[0]?.id) {
      for (let i = 0; i <= 5; i++) await measure('person.activities',
        () => p('getTimelinePage',{personId:String(people.rows[0].id),page:1,pageSize:20}),i?'warm':'first',i);
    }
  } catch { /* Failed measurements remain FAIL. No data or exception text is persisted. */ }
  const result = await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Probe-Nonce': nonce }, body: JSON.stringify({ records }) });
  view.textContent = result.ok ? 'PC31 验证结果已保存 / Results saved. 可以关闭窗口。' : '保存失败 / Save failed.';
  try { await authInst.signOut(); } catch { view.textContent += ' 请关闭窗口以结束测试会话。'; }
}
const html = '<!doctype html><meta charset="utf-8"><title>PC31 只读性能验证</title>' +
  '<style>body{font:16px sans-serif;max-width:720px;margin:48px auto}input,button{padding:12px;margin:8px}</style>' +
  '<h1>PC31 只读性能验证 / Read-only performance check</h1><p>请登录 CRM。只读查询；不写业务数据、不调用 AI、不保存凭据或业务内容。</p>' +
  '<div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div>' +
  '<script src="' + sdk + '"></script><script>var CONFIG={envId:' + JSON.stringify(envId) + '};var app=null;function route(){}' +
  source.slice(start, end) + '\n(' + probe.toString() + ')(' + JSON.stringify(nonce) + ',' + JSON.stringify(remaining) + ',' + JSON.stringify(opportunityOnly) + ');</script>';
const allowedIds = new Set(['recruit.old','recruit.new','recruit.pagination','recruit.parity','people','today','opportunity','activity','search','funnel','reports.customer','reports.recruit','person.activities']);
const phases = new Set(['first','warm','concurrency3','pages','assertion']);
let origin;
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'GET' && req.url === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(html); return; }
  if (req.method !== 'POST' || req.url !== '/result' || req.headers.origin !== origin || req.headers['x-probe-nonce'] !== nonce) { res.writeHead(403); res.end(); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 60000) req.destroy(); });
  req.on('end', () => {
    try {
      const input = JSON.parse(body);
      if (!Array.isArray(input.records) || input.records.length > 300) throw Error('Invalid summary');
      const records = input.records.map(r => {
        if (!allowedIds.has(r.id) || !phases.has(r.phase) || !['PASS','FAIL'].includes(r.status) ||
          !['iteration','ms','bytes','count'].every(k => Number.isFinite(r[k]) && r[k] >= 0)) throw Error('Invalid measurement');
        return Object.fromEntries(['id','phase','iteration','status','ms','bytes','count'].map(k => [k,r[k]]));
      });
      const dir = path.join(root,'tests/security/.results'); fs.mkdirSync(dir,{recursive:true});
      const report = { environment: envId, observedAt: new Date().toISOString(), records };
      fs.writeFileSync(path.join(dir,opportunityOnly?'pc31-live-opportunity.json':remaining?'pc31-live-remaining.json':'pc31-live.json'),JSON.stringify(report,null,2));
      res.end('ok'); console.log(JSON.stringify(report));
      setTimeout(() => server.close(),1000);
    } catch { res.writeHead(400); res.end('Invalid summary'); }
  });
});
server.listen(0,'127.0.0.1', () => {
  origin = 'http://127.0.0.1:' + server.address().port;
  console.log('PC31 login: ' + origin);
  const browser = spawn(process.env.CRM_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--new-window','--no-first-run','--no-default-browser-check','--user-data-dir=' + fs.mkdtempSync(path.join(require('node:os').tmpdir(),'crm-pc31-')),origin], {stdio:'ignore',detached:true});
  browser.on('error', () => { server.close(); process.exitCode = 1; }); browser.unref();
});
