'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('one bilingual iPad entry creates and edits general and customer interactions',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/person/980001');
  await b.wait("document.querySelectorAll('.tab').length>=8");await b.click('.tab','互动时间线');
  await b.wait("document.querySelector('.tab-stack .stack-head button')");
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.tab-stack .stack-head button')].map(x=>x.textContent).filter(x=>/互动|跟进/.test(x))"),['记录互动']);
  await b.click('.stack-head button','记录互动');await b.wait("document.querySelector('[name=summary]')");
  await b.evaluate(`(()=>{document.querySelector('[name=interaction_at]').value='2026-10-30T23:55';document.querySelector('[name=summary]').value='[CRM_TEST_ONLY] general';document.querySelector('[name=raw_note]').value='Full note';const save=[...document.querySelectorAll('.sheet button')].find(x=>x.textContent==='保存');save.click();save.click();})()`);
  await b.wait("!document.querySelector('.sheet')");
  const first=await b.evaluate("window.__crmTest.calls.filter(x=>x.action==='saveUnifiedInteraction')");
  assert.equal(first.length,1);assert.equal(first[0].payload.customer_id,null);
  assert.equal(first[0].payload.interaction_at,await b.evaluate("new Date('2026-10-30T23:55').toISOString()"));
  await b.wait("[...document.querySelectorAll('.tl-item')].some(x=>x.textContent.includes('[CRM_TEST_ONLY] general'))");
  await b.evaluate("[...document.querySelectorAll('.tl-item')].find(x=>x.textContent.includes('[CRM_TEST_ONLY] general')).querySelector('button').click()");
  await b.wait("document.querySelector('[name=summary]')");
  assert.equal(await b.evaluate("document.querySelector('[name=raw_note]').value"),'Full note');
  await b.evaluate("document.querySelector('[name=summary]').value='[CRM_TEST_ONLY] edited';[...document.querySelectorAll('.sheet button')].find(x=>x.textContent==='保存').click()");
  await b.wait("!document.querySelector('.sheet')");
  await b.click('.stack-head button','记录互动');await b.wait("document.querySelector('[name=scene]')");
  await b.evaluate("const s=document.querySelector('[name=scene]');s.value='customer';s.dispatchEvent(new Event('change'))");
  for(const [width,height] of [[820,1180],[1180,820]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});
   const v=await b.evaluate("({width:innerWidth,doc:document.documentElement.scrollWidth,client:document.querySelector('.sheet').clientWidth,scroll:document.querySelector('.sheet').scrollWidth})");
   assert.ok(v.doc<=v.width&&v.scroll<=v.client,JSON.stringify(v));
  }
  await b.evaluate(`(()=>{for(const [key,value] of Object.entries({summary:'[CRM_TEST_ONLY] sales',raw_note:'Full sales note',recommendation_id:'932001',activity_id:'940001',next_followup_date:'2026-11-01',next_followup_goal:'Review',next_action:'Confirm',next_action_date:'2026-11-02'}))document.querySelector('[name='+key+']').value=value;[...document.querySelectorAll('.sheet button')].find(x=>x.textContent==='保存').click();})()`);
  await b.wait("!document.querySelector('.sheet')");await b.wait("[...document.querySelectorAll('.tl-item')].some(x=>x.textContent.includes('[CRM_TEST_ONLY] sales'))");
  await b.evaluate("[...document.querySelectorAll('.tl-item')].find(x=>x.textContent.includes('[CRM_TEST_ONLY] sales')).querySelector('button').click()");await b.wait("document.querySelector('[name=summary]')");
  assert.equal(await b.evaluate("document.querySelector('[name=recommendation_id]').value"),'932001');
  assert.equal(await b.evaluate("document.querySelector('[name=next_action_date]').value"),'2026-11-02');
  await b.click('.sheet button','永久删除跟进');await b.click('.sheet button','永久删除跟进');await b.wait("!document.querySelector('.sheet')");
  await b.wait("![...document.querySelectorAll('.tl-item')].some(x=>x.textContent.includes('[CRM_TEST_ONLY] sales'))");
  await b.evaluate("localStorage.setItem('crm_lang','en');location.reload()");await b.wait("document.querySelectorAll('.tab').length>=8");await b.evaluate("document.querySelectorAll('.tab')[1].click()");
  await b.wait("[...document.querySelectorAll('.tab-stack .stack-head button')].some(x=>x.textContent==='Record interaction')");
  await b.click('.stack-head button','Record interaction');await b.wait("document.querySelector('[name=scene]')");
  assert.equal(await b.evaluate("document.querySelector('[name=scene] option').textContent"),'General conversation');
  await b.healthy();
 }finally{await b.close();}
});
