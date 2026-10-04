'use strict';
// Compare one fictional work item through the normal Person and Today services.
const fs=require('node:fs');
const path=require('node:path');
const {Cdp}=require('../wp03/readonly-live.cjs');
const [kind,idRaw,expected]=process.argv.slice(2);
const id=Number(idRaw);
if(!['action','commitment'].includes(kind)||!Number.isSafeInteger(id)||id<1||
   !['open','in_progress','completed','cancelled'].includes(expected)){
  console.error('kind, ID and expected status required'); process.exitCode=2;
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
    const person=await rpc('listPersonWorkItems',{personId:783});
    const p=person.rows?.find(x=>x.kind===kind&&x.id===id);
    check('person_state',!person.error&&p?.status===expected);
    const today=await rpc('listTodayWorkItems');
    const t=today.rows?.find(x=>x.kind===kind&&x.id===id);
    check('today_same_state',!today.error&&t?.status===expected&&
      t.due_at===p.due_at&&t.completed_at===p.completed_at);
    if((kind==='action'&&id===8)||(kind==='commitment'&&id===2)){
      check('overdue_first_in_kind',today.rows.filter(row=>row.kind===kind&&
        ['open','in_progress'].includes(row.status))[0]?.id===id);
    }
    check('marked_test_data',person.testData?.containsTestData===true&&
      today.testData?.containsTestData===true&&
      String(p.title||p.content).includes('【系统测试·勿联系】'));
    console.log(JSON.stringify({status:'PASS',kind,id,expected,checks},null,2));
  }finally{c.close();}
}
