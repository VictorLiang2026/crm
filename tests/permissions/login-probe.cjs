'use strict';
// Interactive local diagnostic. Reuses the current CRM login implementation; never loads a business route.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const dir = path.join(__dirname, '.results');
fs.mkdirSync(dir, { recursive: true });
const source = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const begin = source.indexOf('var authInst = null;');
const end = source.indexOf('// ==================== 表单生成');
if (begin < 0 || end <= begin) throw new Error('Login source anchors changed');
const loginSource = source.slice(begin, end);
const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] || '';
const targetEnv = 'crm-d1gkae8ddc930d151';
let status = { ready: false }, acceptedVersion = null;

function diagnostic() {
  const marker = '[CRM_PERMISSION_TEST]';
  function errorSummary(e) {
    return { error: String(e?.message || e?.code || (typeof e === 'string' ? e : 'non-Error rejection')).slice(0,200),
      errorKeys: e && typeof e === 'object' ? Object.keys(e) : [],
      nestedErrorCode: typeof e?.error?.code === 'string' ? e.error.code : null,
      nestedErrorMessage: typeof e?.error?.message === 'string' ? e.error.message.slice(0,180) : null };
  }
  function safeClaims(token) {
    if (typeof token !== 'string' || token.split('.').length !== 3) return { jwt: false };
    try { const c = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { jwt: true, role: ['anon','authenticated','service_role'].includes(c.role) ? c.role : 'other-or-absent', hasSub: Boolean(c.sub), expiresInSeconds: c.exp ? Math.floor(c.exp - Date.now()/1000) : null };
    } catch { return { jwt: false }; }
  }
  async function publish(value) {
    await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  }
  async function identity() {
    const out = { ready: true, getSessionAvailable: typeof authInst.getSession === 'function', getAccessTokenAvailable: typeof authInst.getAccessToken === 'function' };
    if (out.getSessionAvailable) {
      const r = await authInst.getSession();
      const s = r?.data?.session || r?.session;
      out.sessionPresent = Boolean(s); out.sessionError = Boolean(r?.error);
      out.sessionShape = Object.keys(s || {});
      out.userPresent = Boolean(s?.user?.id || s?.user?.uid);
      out.tokenClaims = safeClaims(s?.access_token || s?.accessToken);
    }
    if (out.getAccessTokenAvailable) {
      const t = await authInst.getAccessToken();
      out.accessTokenClaims = safeClaims(typeof t === 'string' ? t : t?.accessToken || t?.access_token);
    }
    return out;
  }
  const permitted = new Set(['customers','policy_review_reports','customers_view','followups_view','gifts_view','photos_view','products_view','ai_recommendations_view','v_recruit_candidates','v_recruit_candidates_trash','v_action_center','v_funnel_stats']);
  let doneVersion;
  async function poll() {
    const base = await identity(); await publish(base);
    const plan = await (await fetch('/plan')).json();
    if (plan.version && plan.version !== doneVersion) {
      if (plan.envId !== 'crm-d1gkae8ddc930d151' || !String(plan.marker).startsWith(marker)) throw new Error('Probe plan rejected');
      const results = [];
      for (const q of plan.queries || []) {
        if (!permitted.has(q.table) || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(q.key) || !q.value || q.columns !== q.key) throw new Error('Read query rejected');
        if (q.value !== -2026092101 && q.value !== '[CRM_PERMISSION_TEST]20260921-rls-a') throw new Error('Fixture value rejected');
        const r = await app.rdb().schema('public').from(q.table).select(q.columns).eq(q.key, q.value).limit(1);
        results.push({ table: q.table, key: q.key, count: Array.isArray(r.data) ? r.data.length : null, errorCode: r.error?.code || null, errorMessage: r.error ? String(r.error.message || '').slice(0,180) : null });
      }
      // Only an existing report get for the exact marked fixture is permitted.
      if (Number.isInteger(plan.reportId) && plan.reportId < 0) {
        const r = await callFn('policy_review_reports', { action: 'get', id: plan.reportId });
        results.push({ function: 'policy_review_reports', action: 'get', found: r?.report?.id === plan.reportId,
          markerMatches: r?.report?.customer_name === plan.marker, error: r?.error ? String(r.error).slice(0,180) : null });
      }
      await publish({ ...base, version: plan.version, results });
      doneVersion = plan.version;
      document.getElementById('view').textContent = '本轮权限验证已完成，请保持窗口打开。';
    }
    setTimeout(() => poll().catch(e => publish({ ready: true, ...errorSummary(e) })), 1500);
  }
  (async () => {
    if (await initSdk()) {
      document.getElementById('view').textContent = '测试账号已登录，等待隔离记录验证。不会打开客户列表或生成 AI 建议。';
      await poll();
    }
  })().catch(e => { const detail=errorSummary(e); document.getElementById('view').textContent='登录验证初始化失败：'+detail.error; return publish({ ready: false, ...detail }); });
}
const html = `<!doctype html><meta charset="utf-8"><title>CRM 权限验证 · 测试账号登录</title><style>${style}</style><body><h2>CRM 权限验证：请使用测试账号</h2><div id="env-label"></div><div id="view"></div><div id="modal-root"></div><div id="toast-root"></div><script src="https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js"></script><script>var CONFIG={envId:${JSON.stringify(targetEnv)}};var app=null;function route(){};${loginSource}\n(${diagnostic.toString()})();</script>`;
const server = http.createServer((req,res) => {
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET' && req.url==='/') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(req.method==='GET' && req.url==='/plan') {
    const file=path.join(dir,'probe-plan.json'); res.setHeader('Content-Type','application/json');res.end(fs.existsSync(file)?fs.readFileSync(file):'{}');return;
  }
  if(req.method==='GET' && req.url==='/status') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(status));return;}
  if(req.method==='POST' && req.url==='/result') {
    let body='';req.on('data',chunk=>{body+=chunk;if(body.length>20000)req.destroy();});
    req.on('end',()=>{try {
      const p=JSON.parse(body);
      // Fail closed on common credential material; the page submits only summaries.
      if(/"(?:access_token|accessToken|password|refresh_token|token)"\s*:/.test(body))throw new Error('Sensitive report rejected');
      status=p;
      if(p.version && p.version!==acceptedVersion) {fs.writeFileSync(path.join(dir,'browser-'+p.version+'.json'),JSON.stringify(p,null,2));acceptedVersion=p.version;console.log('Permission probe results saved: '+p.version);}
      fs.writeFileSync(path.join(dir,'login-status.json'),JSON.stringify(p,null,2));res.end('ok');
    }catch{res.writeHead(400);res.end('Invalid report');}});return;
  }
  res.writeHead(404);res.end();
});
server.listen(process.argv.includes('--resume')?42133:0,'127.0.0.1',()=>{
  const url='http://127.0.0.1:'+server.address().port+'/';
  fs.writeFileSync(path.join(dir,'server.json'),JSON.stringify({url,pid:process.pid},null,2));
  const exe=process.env.CRM_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const controlFile=path.join(dir,'browser-control.json');
  const previous=process.argv.includes('--resume')&&fs.existsSync(controlFile)?JSON.parse(fs.readFileSync(controlFile)).profile:null;
  if(previous&&(path.dirname(path.resolve(previous))!==path.resolve(os.tmpdir())||!path.basename(previous).startsWith('crm-permission-login-')))throw new Error('Unexpected browser profile');
  const profile=previous||fs.mkdtempSync(path.join(os.tmpdir(),'crm-permission-login-'));
  const child=spawn(exe,['--no-first-run','--no-default-browser-check','--disable-sync','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'--app='+url],{windowsHide:false,stdio:'ignore'});
  fs.writeFileSync(path.join(dir,'browser-control.json'),JSON.stringify({profile,pid:child.pid},null,2));
  process.on('SIGINT',()=>{child.kill();server.close(()=>process.exit(0));});
  child.on('error',e=>{console.error(e.message);server.close();});
  console.log('Manual test-account login: '+url);
});
