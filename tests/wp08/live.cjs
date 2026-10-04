'use strict';
// Read-only business acceptance plus a server preview in the separately logged-in test window.
// No execute call, credential entry, or real outbound action occurs here.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Cdp } = require('../wp03/readonly-live.cjs');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'tests/security/.results/wp08-live.json');
const marked = '【系统测试·勿联系】';

async function main() {
  const info = JSON.parse(fs.readFileSync(path.join(root,
    'tests/security/.results/wp03-live-window.json'), 'utf8'));
  const base = new URL(info.url);
  if (base.hostname !== '127.0.0.1' || base.pathname !== '/crm/admin.html') {
    throw Error('Unexpected test window');
  }
  const port = fs.readFileSync(path.join(info.profile, 'DevToolsActivePort'), 'utf8')
    .split(/\r?\n/)[0];
  if (!/^\d+$/.test(port)) throw Error('Invalid debugger port');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab = tabs.find(item => item.type === 'page' &&
    item.url.startsWith(base.origin + base.pathname));
  if (!tab) throw Error('Test window closed');
  const c = new Cdp();
  const report = { observedAt:new Date().toISOString(),
    environment:'crm-d1gkae8ddc930d151', mode:'server preview only', checks:[] };
  const check = (id, valid) => {
    report.checks.push({id,status:valid ? 'PASS' : 'FAIL'});
    if (!valid) throw Error(id);
  };
  const rpc = async (action, extra = {}) => c.evaluate(`(async()=>{
    const client=cloudbase.init({env:'crm-d1gkae8ddc930d151'});
    const r=await client.callFunction({name:'person_360',data:${JSON.stringify({action,...extra})}});
    return r.result;
  })()`);
  try {
    await c.open(tab.webSocketDebuggerUrl);
    const unlocked = await c.evaluate("!document.querySelector('input[type=password]')?.offsetParent && Date.now()-Number(localStorage.getItem('crm_last_activity')||0)<300000");
    if (!unlocked) { report.status='MANUAL_LOGIN'; return; }
    const person = await rpc('listPersonWorkItems',{personId:783});
    check('person_list', !person?.error && person.personId===783 &&
      person.rows.some(row => row.kind==='action') &&
      person.rows.some(row => row.kind==='commitment'));
    check('test_notice', person.testData?.containsTestData===true &&
      person.rows.every(row => String(row.title || row.content).includes(marked)));
    const today = await rpc('listTodayWorkItems');
    check('today_list', !today?.error && today.rows.some(row =>
      row.kind==='action' && row.person_id===783));
    const chosen = person.rows.find(row => row.kind==='action' &&
      row.status==='open' && String(row.title).includes(marked));
    check('existing_open_action', !!chosen);
    const key = randomUUID();
    const request = {kind:'action',operation:'complete',personId:783,
      itemId:chosen.id,idempotencyKey:key,draft:{}};
    const preview = await rpc('previewWorkItem',{data:request});
    check('server_preview', !preview?.error && preview.status==='preview' &&
      preview.preview?.personId===783 && preview.preview?.itemId===chosen.id &&
      preview.businessDataWritten===false);
    const again = await rpc('previewWorkItem',{data:request});
    check('idempotent_preview', again.previewId===preview.previewId && again.replayed===true);
    const unchanged = await rpc('listPersonWorkItems',{personId:783});
    check('preview_does_not_change_action', unchanged.rows.some(row =>
      row.kind==='action' && row.id===chosen.id && row.status===chosen.status));
    const forged = await rpc('executeWorkItem',{previewId:randomUUID()});
    check('forged_receipt_rejected', !!forged?.error);
    report.previewId=preview.previewId;
    report.itemId=chosen.id;
    report.status='PASS';
  } catch (error) {
    report.status='FAIL';
    report.reason=String(error.message || error).slice(0,160);
  } finally {
    c.close();
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
    process.exitCode=report.status==='PASS' ? 0 : report.status==='MANUAL_LOGIN' ? 2 : 1;
  }
}
main().catch(error => { console.error(String(error.message || error)); process.exitCode=2; });
