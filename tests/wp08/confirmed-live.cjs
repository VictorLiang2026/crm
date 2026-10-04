'use strict';
// Replay only a receipt already executed by a human in the fictional test window.
const fs=require('node:fs');
const path=require('node:path');
const {Cdp}=require('../wp03/readonly-live.cjs');
const receipt=process.argv[2];
const kind=process.argv[3];
const itemId=Number(process.argv[4]);
if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(receipt||'')||
   !['action','commitment'].includes(kind)||!Number.isSafeInteger(itemId)||itemId<1){
  console.error('Already confirmed preview UUID, kind and item ID required'); process.exitCode=2;
}else main().catch(error=>{console.error(String(error.message||error));process.exitCode=1;});
async function main(){
  const root=path.resolve(__dirname,'../..');
  const info=JSON.parse(fs.readFileSync(path.join(root,
    'tests/security/.results/wp03-live-window.json'),'utf8'));
  const base=new URL(info.url);
  if(base.hostname!=='127.0.0.1'||base.pathname!=='/crm/admin.html')throw Error('Unexpected test window');
  const port=fs.readFileSync(path.join(info.profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab=pages.find(x=>x.type==='page'&&x.url.startsWith(base.origin+base.pathname));
  if(!tab)throw Error('Test window closed');
  const c=new Cdp();
  const checks=[];
  const check=(id,ok)=>{checks.push({id,status:ok?'PASS':'FAIL'});if(!ok)throw Error(id);};
  const rpc=async(action,extra={})=>c.evaluate(`(async()=>{
    const app=cloudbase.init({env:'crm-d1gkae8ddc930d151'});
    return (await app.callFunction({name:'person_360',data:${JSON.stringify({action,...extra})}})).result;
  })()`);
  try{
    await c.open(tab.webSocketDebuggerUrl);
    const unlocked=await c.evaluate("!document.querySelector('input[type=password]')?.offsetParent && Date.now()-Number(localStorage.getItem('crm_last_activity')||0)<300000");
    check('logged_in',unlocked);
    const before=await rpc('listPersonWorkItems',{personId:783});
    const item=before.rows?.find(x=>x.kind===kind&&x.id===itemId);
    check('completed_person',!before.error&&item?.status==='completed'&&!!item.completed_at);
    const today=await rpc('listTodayWorkItems');
    const same=today.rows?.find(x=>x.kind===kind&&x.id===itemId);
    check('same_today_state',!today.error&&same?.status==='completed'&&
      same.completed_at===item.completed_at);
    const result=await rpc('executeWorkItem',{previewId:receipt});
    check('replay_original_id',!result.error&&result.replayed===true&&
      result.kind===kind&&result.itemId===itemId&&result.personId===783);
    const after=await rpc('listPersonWorkItems',{personId:783});
    const current=after.rows?.find(x=>x.kind===kind&&x.id===itemId);
    check('replay_no_state_change',current?.status==='completed'&&
      current.completed_at===item.completed_at);
    console.log(JSON.stringify({status:'PASS',checks},null,2));
  }finally{c.close();}
}
