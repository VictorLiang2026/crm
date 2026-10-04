'use strict';
// Explicit --save uses only the existing registered fictional customer and the old form.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Cdp}=require('../wp03/readonly-live.cjs');
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'tests/security/.results');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const save=process.argv.includes('--save');
 if(process.argv.slice(2).some(x=>x!=='--save'))throw Error('Usage: live.cjs [--save]');
 const info=JSON.parse(fs.readFileSync(path.join(dir,'wp03-live-window.json'),'utf8'));
 const base=new URL(info.url),port=fs.readFileSync(path.join(info.profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];
 if(base.hostname!=='127.0.0.1'||!/^\d+$/.test(port))throw Error('Unexpected test window');
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const tab=tabs.find(t=>t.type==='page'&&t.url.startsWith(base.origin+base.pathname));
 if(!tab)throw Error('Test window closed');
 const c=new Cdp(),report={observedAt:new Date().toISOString(),environment:'crm-d1gkae8ddc930d151',
  status:'UNVERIFIED',mode:save?'confirmed old-form save':'read only',checks:[],
  sourceHash:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'admin.html'))).digest('hex')};
 const check=(id,ok)=>{report.checks.push({id,status:ok?'PASS':'FAIL'});if(!ok)throw Error(id);};
 async function wait(expression){for(let i=0;i<100;i++){if(await c.evaluate(expression))return;await pause(200);}throw Error('UI expectation timed out');}
 async function click(selector,label){await c.evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.textContent.includes(${JSON.stringify(label)}));if(!b||b.disabled)throw Error('Missing enabled button');b.click()})()`);}
 const rpc=(name,data)=>c.evaluate(`(async()=>{const app=cloudbase.init({env:'crm-d1gkae8ddc930d151'});return (await app.callFunction({name:${JSON.stringify(name)},data:${JSON.stringify(data)}})).result})()`);
 try{
  await c.open(tab.webSocketDebuggerUrl);await c.call('Page.bringToFront');
  const unlocked=await c.evaluate("!document.querySelector('input[type=password]')?.offsetParent && Date.now()-Number(localStorage.getItem('crm_last_activity')||0)<300000");
  if(!unlocked){report.status='MANUAL_LOGIN';return;}
  const state=await rpc('assistant',{action:'testSamples',stage:'status'});
  check('registered_scene',state?.ok===true&&state.ready===true&&state.initialCount===10);
  const ids=state.targets;
  check('valid_targets',[ids.personId,ids.customerId].every(x=>/^[1-9]\d*$/.test(String(x))));
  const before=await rpc('person_360',{action:'getCustomerProfile',personId:ids.personId});
  check('deployed_profile',before?.status==='linked'&&before.customerId===String(ids.customerId));
  check('fictional_no_contacts',before.fields.customer_name==='【系统测试·勿联系】虚构体验甲'&&!before.fields.phone&&!before.fields.wx_account);
  check('test_provenance',before.testData?.containsTestData===true&&before.testData.sources.some(s=>s.batchKey==='crm_test_main_v1')&&before.contactAllowed===false);
  report.targets={personId:ids.personId,customerId:ids.customerId};
  report.dryRun={initialNew:0,derivedNew:0,aiNew:0,table:'public.customers',id:ids.customerId,
   field:'occupation',before:before.fields.occupation??null,after:'【系统测试·勿联系】虚构资料验收职业'};
  console.log(JSON.stringify({dryRun:report.dryRun}));
  await c.evaluate("location.hash='#/people'");await wait("!!document.querySelector('.phase14-search input')");
  await c.evaluate(`(()=>{const input=document.querySelector('.phase14-search input');input.value='虚构体验甲';document.querySelector('.phase14-search').requestSubmit()})()`);
  await wait(`!!document.querySelector('.phase14-people-table a[href=${JSON.stringify('#/person/'+ids.personId)}]')`);
  check('people_search_sample',true);
  await c.evaluate(`document.querySelector('.phase14-people-table a[href=${JSON.stringify('#/person/'+ids.personId)}]').click()`);
  await wait("document.querySelector('.person360-profile')?.innerText.includes('编辑基本信息')");
  check('profile_no_duplicate_editor',await c.evaluate("document.querySelectorAll('.person360-profile input,.person360-profile textarea,.person360-profile select').length===0"));
  check('contact_disabled',await c.evaluate("[...document.querySelectorAll('.person360-profile button')].filter(x=>x.textContent.startsWith('复制')).every(x=>x.disabled)"));
  for(const width of [360,390,768]){
   await c.call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
   check('mobile_profile_'+width,await c.evaluate("(()=>{const p=document.querySelector('.person360-profile');return p.scrollWidth<=p.clientWidth+1&&p.getBoundingClientRect().right<=innerWidth+1})()"));
  }
  await c.call('Emulation.clearDeviceMetricsOverride');
  await click('.person360-profile a','编辑基本信息');await wait("document.querySelector('.tab.active')?.textContent==='基本信息'");
  await click('#view button','编辑');await wait("!!document.querySelector('.modal [name=occupation]')");
  check('legacy_url',await c.evaluate('location.hash==='+JSON.stringify('#/customer/'+ids.customerId)));
  if(save){
   await c.evaluate(`(()=>{const f=document.querySelector('.modal [name=occupation]');f.value=${JSON.stringify(report.dryRun.after)};f.dispatchEvent(new Event('input',{bubbles:true}))})()`);
   await click('.modal-footer button','确定');await wait("!document.querySelector('.modal')");
   const after=await rpc('person_360',{action:'getCustomerProfile',personId:ids.personId});
   check('saved_and_fresh',after.fields.occupation===report.dryRun.after);
   check('other_profile_fields_unchanged',Object.keys(before.fields).filter(k=>!['occupation','updated_at'].includes(k)).every(k=>JSON.stringify(before.fields[k])===JSON.stringify(after.fields[k])));
  }else await click('.modal button','取消');
  await click('#view .toolbar a','Person 360');await wait("document.querySelector('.person360-profile')?.innerText.includes('编辑基本信息')");
  if(save)check('returned_view_fresh',await c.evaluate('document.querySelector(".person360-profile").innerText.includes('+JSON.stringify(report.dryRun.after)+')'));
  await click('.person360-profile a','编辑客户画像');await wait("document.querySelector('.tab.active')?.textContent==='客户画像'");
  check('legacy_profile_operable',await c.evaluate("[...document.querySelectorAll('#view button')].some(x=>x.textContent==='手动编辑')"));
  const afterState=await rpc('assistant',{action:'testSamples',stage:'status'});
  report.counts={initial:afterState.initialCount,derived:afterState.derivedCount,audit:afterState.auditCount};
  check('no_new_records',['initialCount','derivedCount','auditCount'].every(k=>afterState[k]===state[k]));
  report.status='PASS';
 }catch(e){report.status='FAIL';report.reason=report.checks.at(-1)?.status==='FAIL'?report.checks.at(-1).id:'UI or service verification failed';}
 finally{
  c.close();fs.writeFileSync(path.join(dir,'wp05-live.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='PASS'?0:report.status==='MANUAL_LOGIN'?2:1;
 }
}
if(require.main===module)main().catch(()=>{console.error('WP05 live window unavailable; not verified');process.exitCode=2;});
