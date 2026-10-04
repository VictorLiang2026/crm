'use strict';
// Replays only an already-executed, human-confirmed fictional Person receipt.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Cdp } = require('../wp03/readonly-live.cjs');
const root = path.resolve(__dirname, '../..');
const receipt = '5b54466e-f301-4594-85de-ff8f6ce823bc';

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
  try {
    await c.open(tab.webSocketDebuggerUrl);
    const unlocked = await c.evaluate("!document.querySelector('input[type=password]')?.offsetParent && Date.now()-Number(localStorage.getItem('crm_last_activity')||0)<300000");
    if (!unlocked) throw Error('Manual test login required');
    const rpc = async previewId => c.evaluate(`(async()=>{
      const client=cloudbase.init({env:'crm-d1gkae8ddc930d151'});
      const r=await client.callFunction({name:'person_360',data:${JSON.stringify({ action:'executeIdentity', data:{ previewId } })}});
      return r.result;
    })()`);
    const replay = await rpc(receipt);
    if (replay?.error || Number(replay?.personId) !== 784 || replay?.customerId || replay?.recruitId) {
      throw Error('Confirmed receipt did not replay original IDs');
    }
    const forged = await rpc(randomUUID());
    if (!forged?.error) throw Error('Forged receipt was accepted');
    console.log(JSON.stringify({ status:'PASS', checks:['same_person_id','no_new_role_ids','forged_receipt_rejected'] }));
  } finally { c.close(); }
}
main().catch(error => { console.error(String(error.message || error)); process.exitCode = 1; });
