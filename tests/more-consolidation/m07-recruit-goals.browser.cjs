'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('M07 goal gaps distinguish shortfall and overage and refresh after atomic saves',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.more-section')");
  await b.evaluate(`(async()=>{
   const {renderRecruitGoals}=await import('/crm/js/modules/console/recruit-goals.js');
   const host=document.querySelector('#console-main');window.m07={target:5,reads:0,saves:[],fail:false};
   window.m07ctx={main:host,operator:{name:'[CRM_TEST_ONLY]'},api:{call:async(name,args)=>{
    if(name!=='recruit_goals')throw Error('Unexpected function');
    if(args.action==='listGoals')return{rows:[{stage:'新增人才',target_count:window.m07.target}]};
    if(args.action==='getProgress'){window.m07.reads++;return{rows:[{stage:'新增人才',target:window.m07.target,actual:3},{stage:'签约入司',target:1,actual:3}],trends:[],overall:{}};}
    if(args.action==='saveGoals'){if(window.m07.fail)throw Error('TEST_SAVE_FAILED');window.m07.saves.push(args);window.m07.target=args.goals['新增人才'];return{ok:true};}
    throw Error('Unexpected action');
   }}};window.m07render=renderRecruitGoals;renderRecruitGoals(window.m07ctx);
  })()`);
  await b.wait("document.querySelectorAll('.goal-gap').length===2 && document.querySelector('input[type=number]')");
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.goal-gap')].map(n=>n.textContent)"),['2','-2']);
  assert.match(await b.evaluate("document.querySelector('.goal-gap').title"),/负数表示超额/);
  assert.equal(await b.evaluate("document.querySelector('.recruit-goals-advanced').open"),false);
  assert.equal(await b.evaluate("document.querySelector('.recruit-goals-advanced a').getAttribute('href')"),'/crm/admin.html#/recruit/goals');
  await b.evaluate("document.querySelector('input[type=number]').value='8';[...document.querySelectorAll('#console-main button')].find(b=>b.textContent==='保存本月目标').click()");
  await b.wait("document.querySelector('.goal-gap')?.textContent==='5' && window.m07.reads===2");
  const save=await b.evaluate('window.m07.saves[0]');assert.equal(Object.keys(save.goals).length,7);assert.equal(save.goals['新增人才'],8);
  await b.evaluate("window.m07.fail=true;document.querySelector('input[type=number]').value='9';[...document.querySelectorAll('#console-main button')].find(b=>b.textContent==='保存本月目标').click()");
  await b.wait("document.querySelector('#console-main').textContent.includes('TEST_SAVE_FAILED')");
  assert.equal(await b.evaluate('window.m07.reads'),2);assert.equal(await b.evaluate("document.querySelector('input[type=number]').value"),'9');
  await b.evaluate(`(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');window.m07render(window.m07ctx)})()`);
  await b.wait("document.querySelector('.recruit-goals-advanced summary')?.textContent==='Advanced Goal Tools'");
  assert.match(await b.evaluate("document.querySelector('.goal-gap').title"),/target minus actual/);
  for(const size of [{width:820,height:1180},{width:1180,height:820}]){
   await b.send('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:2,mobile:false});
   assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  }
  await b.healthy();
 }finally{await b.close();}
});
