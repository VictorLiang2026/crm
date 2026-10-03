'use strict';
// Read-only acceptance in the user's authenticated, isolated CRM test window.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Cdp}=require('../wp03/readonly-live.cjs');
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'tests/security/.results');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const info=JSON.parse(fs.readFileSync(path.join(dir,'wp03-live-window.json'),'utf8'));
 const base=new URL(info.url),port=fs.readFileSync(path.join(info.profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];
 if(base.hostname!=='127.0.0.1'||base.pathname!=='/crm/admin.html'||!/^[0-9]+$/.test(port))throw Error('Unexpected test window');
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const tab=tabs.find(t=>t.type==='page'&&t.url.startsWith(base.origin+base.pathname));
 if(!tab)throw Error('Test window closed');
 const c=new Cdp(),report={environment:'crm-d1gkae8ddc930d151',observedAt:new Date().toISOString(),status:'UNVERIFIED',checks:[],
  adminHash:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'admin.html'))).digest('hex')};
 const check=(id,ok)=>{report.checks.push({id,status:ok?'PASS':'FAIL'});if(!ok)throw Error(id);};
 const rpc=(name,data)=>c.evaluate(`(async()=>{const app=cloudbase.init({env:'crm-d1gkae8ddc930d151'});return (await app.callFunction({name:${JSON.stringify(name)},data:${JSON.stringify(data)}})).result})()`);
 async function wait(expr){for(let i=0;i<80;i++){if(await c.evaluate(expr))return;await pause(250);}throw Error('UI check timed out');}
 try{
  await c.open(tab.webSocketDebuggerUrl);
  const unlocked=await c.evaluate("!document.querySelector('input[type=password]')?.offsetParent && Date.now()-Number(localStorage.getItem('crm_last_activity')||0)<300000");
  if(!unlocked){report.status='MANUAL_LOGIN';return;}
  const before=await rpc('assistant',{action:'testSamples',stage:'status'});
  check('registered_scene',before?.ok===true&&before.ready===true&&before.initialCount===10);
  const id=String(before.targets?.personId||'');check('sample_person_id',/^[1-9]\d*$/.test(id));
  const timeline=await rpc('person_360',{action:'getTimelinePage',personId:id,page:1,pageSize:10});
  check('deployed_timeline',Array.isArray(timeline?.rows)&&timeline.page===1);
  check('followup_from_original_source',timeline.rows.some(r=>r.source?.startsWith('public.followups#')));
  check('only_actual_attendance',timeline.rows.some(r=>r.type==='activity_participation'&&r.source?.startsWith('public.activity_participants#')));
  check('no_duplicate_source',new Set(timeline.rows.map(r=>r.source)).size===timeline.rows.length);
  check('visible_fictional_marker',timeline.rows.every(r=>String(r.summary).includes('【系统测试·勿联系】')));
  check('timeline_test_notice',timeline.testData?.status==='verified'&&timeline.testData.containsTestData===true);
  const context=await rpc('person_360',{action:'getContextGroups',personId:id});
  check('context_groups',context?.groups&&['fact','signal','inference'].every(k=>Array.isArray(context.groups[k])));
  check('context_disclosure_verified',context.testData?.status==='verified');
  await c.evaluate(`location.hash='#/person/${id}'`);
  await wait("document.querySelector('.person360-timeline')?.innerText.includes('统一互动时间线')");
  await wait("document.querySelector('.person360-timeline')?.innerText.includes('含测试数据')");
  check('page_test_notice',true);
  check('page_context_columns',await c.evaluate("document.querySelectorAll('.person360-context-column').length===3"));
  await c.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  check('mobile_390',await c.evaluate("(()=>{const x=document.querySelector('.person360-context'),r=x.getBoundingClientRect();return x.scrollWidth<=x.clientWidth+1&&r.right<=innerWidth+1})()"));
  await c.call('Emulation.clearDeviceMetricsOverride');
  const after=await rpc('assistant',{action:'testSamples',stage:'status'});
  report.counts={initial:after.initialCount,derived:after.derivedCount,audit:after.auditCount};
  check('no_data_change',['initialCount','derivedCount','auditCount'].every(k=>after[k]===before[k]));
  report.sample={personId:id,sourceIds:timeline.rows.map(r=>r.source)};
  report.status='PASS';
 }catch(e){report.status='FAIL';report.reason=report.checks.at(-1)?.status==='FAIL'?report.checks.at(-1).id:'UI or service verification failed';}
 finally{c.close();fs.writeFileSync(path.join(dir,'wp06-live.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks,counts:report.counts,reason:report.reason},null,2));process.exitCode=report.status==='PASS'?0:report.status==='MANUAL_LOGIN'?2:1;}
}
if(require.main===module)main().catch(()=>{console.error('WP06 live window unavailable; not verified');process.exitCode=2;});
