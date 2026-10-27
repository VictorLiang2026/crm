'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('dual follow-up auto-generates both recommendations from client context and records only the explicit human choice',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/people','authCase=1');await b.wait("document.querySelector('.console-main')");
  await b.evaluate(`(async()=>{
   const {renderDualFollowup}=await import('/crm/js/modules/console/dual-followup.js');
   const common={summary:'Suggested approach',reasoning:'Based on the stated context',clarifyingQuestions:['Confirm the goal'],
    nextAction:'Arrange a review',messageDraft:'Would a short review be useful?',boundaryNotes:['Check suitability'],sourceRefs:[],matchStatus:'no_matching_sources'};
   const result={ok:true,taskId:'12',candidates:[{...common,id:'56',candidateType:'strategy_based'},
    {...common,id:'57',candidateType:'library_based',sourceRefs:[{id:'10',title:'Approved source',sourceDate:'2026-01-01',excerpt:'Verified company guidance'}],matchStatus:'matched'}]};
   const calls=[];const ctx={main:document.querySelector('.console-main'),api:{call:async(name,payload)=>{
    calls.push({name,payload});if(payload.operation==='dualGenerate')return {ok:true,status:'pending',taskId:'12',personId:'42'};
    if(payload.action==='aiTaskStatus')return {...result,status:'completed'};
    if(payload.operation==='dualHistory')return {ok:true,rows:[]};
    if(payload.operation==='dualSelect')return {ok:true,status:'selected'};
    throw Error('unexpected call');}}};
   window.dfCalls=calls;window.dfI18n=await import('/crm/js/modules/console/i18n.js');
   window.dfRender=()=>renderDualFollowup(ctx,'42');window.dfRender();
  })()`);
  await b.wait("window.dfCalls.some(x=>x.payload.operation==='dualGenerate')");
  await b.wait("document.querySelectorAll('.df-candidate').length===2");
  const pair=await b.evaluate(`({titles:[...document.querySelectorAll('.df-candidate h2')].map(x=>x.textContent),buttons:[...document.querySelectorAll('.df-candidate button')].map(x=>x.textContent.trim()),source:document.querySelector('.df-sources')?.innerText,hash:location.hash,inputs:document.querySelectorAll('[name="question"],[name="market"]').length,backgrounds:[...document.querySelectorAll('.df-candidate')].map(x=>getComputedStyle(x).backgroundColor),request:window.dfCalls.find(x=>x.payload.operation==='dualGenerate')?.payload.data})`);
  assert.deepEqual(pair.titles,['行业经验与销售策略','公司资料库建议']);
  assert.deepEqual(pair.buttons,['采用这份建议','采用这份建议']);
  assert.match(pair.source,/Approved source/);
  assert.equal(pair.inputs,0);
  assert.deepEqual(pair.backgrounds,[pair.backgrounds[0],pair.backgrounds[0]]);
  assert.deepEqual(pair.request,{personId:'42',asyncWait:true});
  await b.evaluate("document.querySelectorAll('.df-candidate button')[1].click()");
  await b.wait("window.dfCalls.some(x=>x.payload.operation==='dualSelect')");
  const selected=await b.evaluate("window.dfCalls.filter(x=>x.payload.operation==='dualSelect').map(x=>x.payload.data.resultId)");
  assert.deepEqual(selected,['57']);
  assert.equal(await b.evaluate("window.dfCalls.some(x=>['create','update','delete','execute'].includes(x.payload.action))"),false);
  await b.evaluate("window.dfI18n.setLang('en');window.dfRender()");
  await b.wait("document.querySelectorAll('.df-candidate').length===2");
  assert.match(await b.evaluate("document.querySelector('#console-main').innerText"),/Industry experience and sales strategy/);
  await b.healthy();
 }finally{await b.close();}
});
