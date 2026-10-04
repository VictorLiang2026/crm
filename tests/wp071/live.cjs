'use strict';
// Read-only WP07.1 production acceptance in the separately logged-in test window.
const fs = require('node:fs');
const path = require('node:path');
const { Cdp } = require('../wp03/readonly-live.cjs');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'tests/security/.results/wp071-live.json');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const info = JSON.parse(fs.readFileSync(path.join(root, 'tests/security/.results/wp03-live-window.json'), 'utf8'));
  const base = new URL(info.url);
  if (base.hostname !== '127.0.0.1' || base.pathname !== '/crm/admin.html') throw Error('Unexpected test window');
  const port = fs.readFileSync(path.join(info.profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
  if (!/^\d+$/.test(port)) throw Error('Invalid debugger port');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab = tabs.find(item => item.type === 'page' && item.url.startsWith(base.origin + base.pathname));
  if (!tab) throw Error('Test window closed');
  const c = new Cdp();
  const report = { observedAt: new Date().toISOString(), environment: 'crm-d1gkae8ddc930d151',
    mode: 'read only', checks: [] };
  const check = (id, ok) => { report.checks.push({ id, status: ok ? 'PASS' : 'FAIL' }); if (!ok) throw Error(id); };
  const rpc = async (action, extra = {}) => c.evaluate(`(async()=>{
    const client=cloudbase.init({env:'crm-d1gkae8ddc930d151'});
    const r=await client.callFunction({name:'person_360',data:${JSON.stringify({ action, ...extra })}});
    return r.result;
  })()`);
  try {
    await c.open(tab.webSocketDebuggerUrl);
    const unlocked = await c.evaluate("!document.querySelector('input[type=password]')?.offsetParent && Date.now()-Number(localStorage.getItem('crm_last_activity')||0)<300000");
    if (!unlocked) { report.status = 'MANUAL_LOGIN'; return; }
    const first = await rpc('listPeople', { page: 1, pageSize: 50, sortField: 'id', sortDir: 'desc' });
    check('server_page', !first?.error && first.page === 1 && first.pageSize === 50 && first.total >= 50 && first.rows.length === 50);
    check('server_desc', first.rows.every((row, i) => i === 0 || Number(first.rows[i - 1].id) > Number(row.id)));
    const second = await rpc('listPeople', { page: 2, pageSize: 50, sortField: 'id', sortDir: 'desc' });
    check('server_page_boundary', !second?.error && second.rows.length <= 50 && Number(first.rows.at(-1).id) > Number(second.rows[0]?.id));
    const asc = await rpc('listPeople', { page: 1, pageSize: 50, sortField: 'id', sortDir: 'asc' });
    check('server_asc', !asc?.error && asc.rows.every((row, i) => i === 0 || Number(asc.rows[i - 1].id) < Number(row.id)));
    const over = await rpc('listPeople', { page: 1, pageSize: 51, sortField: 'id', sortDir: 'desc' });
    check('limit_rejected', !!over?.error);
    const invalid = await rpc('listPeople', { page: 1, pageSize: 50, sortField: 'phone', sortDir: 'desc' });
    check('sort_injection_rejected', !!invalid?.error);
    const test = await rpc('listPeople', { keyword: '【系统测试·勿联系】虚构体验甲', pageSize: 50 });
    check('ordinary_test_search', !test?.error && test.rows.some(row => String(row.display_name).includes('虚构体验甲')));
    const resolved = await rpc('resolveIdentity', { name: '【系统测试·勿联系】虚构体验甲' });
    check('identity_requires_human', !resolved?.error && resolved.selectedPersonId == null && resolved.candidates.length >= 1);
    const unmarkedKey = require('node:crypto').randomUUID();
    const unmarked = await rpc('previewIdentity', { data: { kind: 'person',
      idempotencyKey: unmarkedKey, displayName: '张三（测试）' } });
    check('test_account_unmarked_new_person_rejected', /fictional marked Person/.test(String(unmarked?.error || '')));
    const existing = asc.rows.find(row => !String(row.display_name).includes('【系统测试·勿联系】'));
    if (existing) {
      const unmarkedExisting = await rpc('previewIdentity', { data: { kind: 'recruit',
        idempotencyKey: require('node:crypto').randomUUID(), personId: existing.id } });
      check('test_account_unmarked_existing_person_rejected',
        /fictional marked Person/.test(String(unmarkedExisting?.error || '')));
    }
    await c.evaluate("location.hash='#/people'");
    let ready = false;
    for (let i = 0; i < 80; i++) {
      ready = await c.evaluate("!!document.querySelector('.phase14-people-table tbody tr')");
      if (ready) break;
      await pause(250);
    }
    check('ui_loaded', ready);
    check('seven_columns', await c.evaluate("[...document.querySelectorAll('.phase14-people-table thead th')].map(x=>x.textContent.trim()).join('|').replace(/ ↑| ↓/g,'')==='编号|姓名|角色|职业／机构|最近更新|转客户|转增员'"));
    check('no_contact_column', await c.evaluate("![...document.querySelectorAll('.phase14-people-table thead th')].some(x=>/电话|手机|微信/.test(x.textContent))"));
    check('ui_page_limit', await c.evaluate("document.querySelectorAll('.phase14-people-table tbody tr').length<=50"));
    await c.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    check('mobile_scroll_container', await c.evaluate("(()=>{const e=document.querySelector('.phase14-table-scroll');return !!e&&e.clientWidth<e.scrollWidth&&document.documentElement.scrollWidth<=innerWidth+1})()"));
    await c.call('Emulation.clearDeviceMetricsOverride');
    report.total = first.total;
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.reason = report.checks.at(-1)?.status === 'FAIL' ? report.checks.at(-1).id : String(error.message || 'Browser or service check failed').slice(0, 120);
  } finally {
    c.close();
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'PASS' ? 0 : report.status === 'MANUAL_LOGIN' ? 2 : 1;
  }
}
if (require.main === module) main().catch(() => { console.error('WP07.1 live window unavailable'); process.exitCode = 2; });
