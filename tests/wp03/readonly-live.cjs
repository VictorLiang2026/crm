'use strict';
// Uses the user's already authenticated test window. Never submits credentials,
// confirms a receipt, seeds data, runs AI, or writes business records.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'tests/security/.results');
const env = 'crm-d1gkae8ddc930d151';
const pause = ms => new Promise(r => setTimeout(r, ms));
class Cdp {
  async open(url) {
    this.ws = new WebSocket(url); this.pending = new Map(); this.id = 0;
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data), item = this.pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer); this.pending.delete(message.id);
      message.error ? item.reject(Error('Browser protocol failure')) : item.resolve(message.result);
    };
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Browser check timed out')); }, 180000);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
    if (result.exceptionDetails) throw Error('Browser check raised an exception; no private payload retained');
    return result.result.value;
  }
  close() { for (const p of this.pending.values()) clearTimeout(p.timer); this.ws?.close(); }
}
async function probe(names) {
  const checks = [];
  const add = (id, passed) => { checks.push({ id, status:passed ? 'PASS' : 'FAIL' }); if (!passed) throw Error('CHECK_FAILED'); };
  try {
    // Respect the existing five-minute UI lock even when a JWT has not expired.
    const lastActivity = Number(localStorage.getItem('crm_last_activity'));
    if (document.querySelector('input[type=password]')?.offsetParent || !lastActivity || Date.now()-lastActivity>300000) {
      return {checks:[{id:'live.login',status:'MANUAL_LOGIN'}]};
    }
    const app = cloudbase.init({ env:'crm-d1gkae8ddc930d151' });
    const auth = app.auth({ persistence:'local' }), session = (await auth.getSession())?.data?.session;
    if (!session) return { checks:[{id:'live.login',status:'MANUAL_LOGIN'}] };
    add('live.login', true);
    let token = session.access_token || session.accessToken;
    if (!token) { const t = await auth.getAccessToken(); token = typeof t === 'string' ? t : t?.accessToken || t?.access_token; }
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    add('live.authenticated_role', claims.role === 'authenticated' && claims.exp * 1000 > Date.now());
    for (const name of names) {
      const r = await fetch('https://crm-d1gkae8ddc930d151.api.tcloudbasegateway.com/v1/rdb/rest/' + name + '?select=*&limit=0', {
        method:'HEAD', headers:{Authorization:'Bearer ' + token,'Accept-Profile':'public'}, signal:AbortSignal.timeout(15000)
      });
      add('authenticated.' + name, r.status === 403);
    }
    const call = async (name, data) => (await app.callFunction({name,data})).result;
    const state = await call('assistant', {action:'testSamples',stage:'status'});
    add('scene.ready', state?.ok === true && state.ready === true && state.initialCount === 10);
    for (const extra of [{count:11},{batchKey:'crm_test_spoof'},{confirmed:true},{personId:'999999999'}]) {
      const r = await call('assistant',{action:'testSamples',stage:'dryRun',...extra});
      add('seed.reject.' + Object.keys(extra)[0], r?.ok === false && r.error?.code === 'SEED_INVALID_REQUEST');
    }
    const r = await call('assistant',{action:'testSamples',stage:'execute',previewId:'invalid'});
    add('seed.reject.invalid_receipt', r?.ok === false && r.error?.code === 'CONFIRMATION_REQUIRED');
    const again = await call('assistant',{action:'testSamples',stage:'status'});
    add('scene.counts_unchanged', ['initialCount','derivedCount','auditCount'].every(k => again[k] === state[k]));
    const today = await call('today_coach',{action:'candidates'});
    add('today.ordinary_sources', !today?.error && today.testData?.status === 'verified' && today.testData.containsTestData === true && today.testData.sources.some(s=>s.batchKey==='crm_test_main_v1'));
    return {checks,targets:state.targets,counts:{initial:state.initialCount,derived:state.derivedCount,ai_audit:state.auditCount}};
  } catch { if (!checks.some(c=>c.status==='FAIL')) checks.push({id:'live.unexpected_error',status:'FAIL'}); return {checks}; }
}
async function main() {
  const info = JSON.parse(fs.readFileSync(path.join(dir,'wp03-live-window.json'),'utf8'));
  const base = new URL(info.url);
  if (base.hostname !== '127.0.0.1' || base.pathname !== '/crm/admin.html') throw Error('Unexpected test window');
  const port = fs.readFileSync(path.join(info.profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];
  if (!/^\d+$/.test(port)) throw Error('Invalid debugger port');
  const endpoint = 'http://127.0.0.1:' + port;
  const pages = await (await fetch(endpoint + '/json/list')).json();
  const eligible = pages.filter(t=>t.type==='page' && t.url.startsWith(base.origin + base.pathname));
  const target = eligible.find(t=>t.url.endsWith('#/test-scenario')) || eligible[0];
  if (!target) throw Error('Open the WP03 test window first');
  const cdp = new Cdp(); let page;
  const checks = [], report = {environment:env,observedAt:new Date().toISOString(),checks};
  report.adminHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'admin.html'))).digest('hex');
  try {
    await cdp.open(target.webSocketDebuggerUrl);
    const names = require('../security/expected-public-baseline.json').objects.filter(o=>o.kind==='relation').map(o=>o.name);
    const live = await cdp.evaluate('(' + probe.toString() + ')(' + JSON.stringify(names) + ')');
    checks.push(...live.checks); report.counts = live.counts;
    if (checks.some(c=>c.status!=='PASS')) return;
    const ids = live.targets;
    if (![ids.personId,ids.customerId,ids.activityId].every(id=>/^[1-9][0-9]*$/.test(String(id)))) throw Error('Invalid scene target');
    const created = await cdp.call('Target.createTarget',{url:base.origin + base.pathname + '#/test-scenario'});
    page = new Cdp();
    const tabs = await (await fetch(endpoint + '/json/list')).json();
    await page.open(tabs.find(t=>t.id===created.targetId).webSocketDebuggerUrl);
    const routes = [
      ['scene','#/test-scenario',"text.includes('初始样本 10 / 10') && text.includes('已有测试场景')"],
      ['person','#/person/'+ids.personId,"!!document.querySelector('#view .person360 h2') && text.includes('【系统测试·勿联系】虚构体验甲')"],
      ['customer','#/customer/'+ids.customerId,"!!document.querySelector('#view .tabs') && text.includes('【系统测试·勿联系】虚构体验甲') && text.includes('跟进记录')"],
      ['activity','#/activity/'+ids.activityId,"text.includes('【系统测试·勿联系】') && text.includes('日期：') && text.includes('+ 新增活动')"],
      ['funnel','#/funnels',"text.includes('含测试数据')"]
    ];
    for (const [id,hash,condition] of routes) {
      await page.evaluate('location.hash=' + JSON.stringify(hash));
      await pause(250); // Let hashchange clear the previous page before checking its successor.
      let state;
      for (let i=0;i<60;i++) {
        state = await page.evaluate(`(()=>{const text=document.getElementById('view')?.innerText||'';const error=/加载失败|读取失败/.test(text);return {ready:location.hash===${JSON.stringify(hash)} && !error && (${condition}),error,login:!!document.querySelector('input[type=password]')?.offsetParent};})()`);
        if (state.ready || state.login || state.error) break;
        await pause(250);
      }
      checks.push({id:'ui.'+id,status:state?.ready?'PASS':state?.login?'MANUAL_LOGIN':'FAIL'});
      if (!state?.ready) return;
    }
    await page.evaluate("location.hash='#/test-scenario'");
    await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await pause(1500);
    const mobile = await page.evaluate(`(()=>{const text=document.getElementById('view')?.innerText||'';return {ready:text.includes('初始样本 10 / 10'),overflow:document.documentElement.scrollWidth>innerWidth+1,executeDisabled:[...document.querySelectorAll('#view button')].find(b=>b.textContent.startsWith('3.'))?.disabled};})()`);
    checks.push({id:'ui.scene_390px',status:mobile.ready&&!mobile.overflow&&mobile.executeDisabled?'PASS':'FAIL'});
    await page.call('Emulation.clearDeviceMetricsOverride');
    report.mobileScope = 'Desktop browser viewport simulation only; no real mobile device';
  } catch { checks.push({id:'runner',status:'FAIL'}); }
  finally {
    page?.close(); cdp.close();
    report.acceptance = 'NOT_ASSESSED'; // Read-only success cannot establish live AI generation acceptance.
    report.separateEvidence = { historicalToday:'wp03-ui-today.json', currentToday:'wp03-today-live.json' };
    const serialized = JSON.stringify(report,null,2)+'\n';
    fs.writeFileSync(path.join(dir,'wp03-readonly-live-' + report.observedAt.replace(/[:.]/g,'-') + '.json'),serialized);
    fs.writeFileSync(path.join(dir,'wp03-readonly-live.json'),serialized);
    console.log(JSON.stringify({checks,counts:report.counts,acceptance:report.acceptance,separateEvidence:report.separateEvidence}));
    process.exitCode = checks.some(c=>c.status==='FAIL') ? 1 : checks.some(c=>c.status!=='PASS') ? 2 : 0;
  }
}
if (require.main === module) main().catch(()=>{console.error('WP03 read-only probe incomplete; no acceptance pass inferred');process.exitCode=1;});
module.exports = { probe, Cdp };
