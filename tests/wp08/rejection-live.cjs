'use strict';
// Negative tests only; no confirmed preview or normal business row is written.
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Cdp}=require('../wp03/readonly-live.cjs');
const expiredReceipt=process.argv[2];
if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(expiredReceipt||'')){
  console.error('Expired preview UUID required');process.exitCode=2;
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
  const check=(name,ok)=>{checks.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error(name);};
  const rpc=async(action,extra={})=>c.evaluate(`(async()=>{
    const app=cloudbase.init({env:'crm-d1gkae8ddc930d151'});
    return (await app.callFunction({name:'person_360',data:${JSON.stringify({action,...extra})}})).result;
  })()`);
  try{
    await c.open(tab.webSocketDebuggerUrl);
    const before=await rpc('listPersonWorkItems',{personId:783});
    const action=before.rows?.find(x=>x.kind==='action'&&x.id===7);
    check('baseline',!before.error&&action?.status==='completed');
    const expired=await rpc('executeWorkItem',{previewId:expiredReceipt});
    check('expired_rejected',/expired/i.test(String(expired?.error||'')));
    const forged=await rpc('previewWorkItem',{data:{kind:'action',operation:'create',
      personId:999999999,idempotencyKey:randomUUID(),draft:{
        title:'【系统测试·勿联系】拒绝伪造人物',description:'',dueAt:null,priority:'low'}}});
    check('forged_person_rejected',!!forged?.error);
    const wrong=await rpc('previewWorkItem',{data:{kind:'action',operation:'complete',
      personId:784,itemId:7,idempotencyKey:randomUUID(),draft:{}}});
    check('cross_person_item_rejected',!!wrong?.error);
    const after=await rpc('listPersonWorkItems',{personId:783});
    const same=after.rows?.find(x=>x.kind==='action'&&x.id===7);
    check('no_business_state_change',same?.status===action.status&&
      same.completed_at===action.completed_at);
    console.log(JSON.stringify({status:'PASS',checks},null,2));
  }finally{c.close();}
}
