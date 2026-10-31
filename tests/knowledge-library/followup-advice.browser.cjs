'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('paired follow-up advice compares both models and requires explicit GPT preview confirmation',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/people','authCase=1');
  await b.wait("document.querySelector('.console-main')");
  await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');
   const advice={id:'81',personId:'42',title:'退休规划回访',updatedAt:'2026-10-31T01:00:00.000Z',
    system:{status:'ready',version:2,strategy:'先确认客户近期目标，再约定复盘。',productAdvice:'核实需求后再介绍适配服务。',strategySources:[],productSources:[]},
    gpt:{status:'stale',basedOnSystemVersion:1,strategy:'先确认目标。',productAdvice:'待进一步核实。',strategySources:[],productSources:[]}};
   window.faCalls=[];
   data.followupAdviceList=async()=>({rows:[advice]});data.dualFollowupHistory=async()=>({rows:[]});
   data.updateFollowupAdvice=async(_ctx,payload)=>{window.faCalls.push(payload);return {ok:true};};
   data.deleteFollowupAdvice=async()=>({ok:true});
   data.keepGptFollowupAdvice=async()=>({ok:true});
   data.gptFollowupTaskPackage=async(_ctx,payload)=>({rows:[],nextAfterId:payload.afterId?'':'81'});
   data.previewGptFollowupImport=async(_ctx,payload)=>{window.faCalls.push({preview:payload});return {rows:[{adviceId:'81',personId:'42',title:'退休规划回访',systemVersion:2,status:'preview',previewId:'preview-uuid',gptAdvice:{overallStrategy:'保持双向确认。',productServiceAdvice:'来源核验后再介绍。'}}]};};
   data.confirmGptFollowupImport=async(_ctx,payload)=>{window.faCalls.push({confirm:payload});return {ok:true};};
   const {renderFollowupAdvice,renderFollowupAdviceTasks}=await import('/crm/js/modules/console/followup-advice.js');
   const ctx={main:document.querySelector('.console-main'),api:{call:async()=>({ok:true,rows:[]})}};
   window.faCtx=ctx;window.faRender=()=>renderFollowupAdvice(ctx,'42');
   window.faRenderTasks=()=>renderFollowupAdviceTasks(ctx);window.faRender();
   window.faData=data;
  })()`);
  await b.wait("document.querySelectorAll('.fa-lane').length===2");
  const parallel=await b.evaluate(`({lanes:[...document.querySelectorAll('.fa-lane-head h3')].map(n=>n.textContent),sections:[...document.querySelectorAll('.fa-section h4')].map(n=>n.textContent),status:document.querySelector('.fa-status-stale')?.textContent})`);
  assert.deepEqual(parallel.lanes,['CloudBase AI','GPT']);
  assert.deepEqual(parallel.sections,['整体跟进策略','产品与服务建议','整体跟进策略','产品与服务建议']);
  assert.match(parallel.status,/系统版已更新/);
  await b.evaluate("document.querySelector('.fa-row-actions .btn-ghost').click()");
  await b.wait("document.querySelector('.fa-modal select')");
  await b.evaluate("document.querySelector('.fa-modal select').value='delete';document.querySelector('.fa-modal .btn-primary').click()");
  await b.wait("window.faCalls.some(x=>x.gptAction==='delete')");
  await b.evaluate('window.faRenderTasks()');
  await b.wait("document.querySelector('.fa-json-box[readonly]')");
  await b.wait("document.querySelector('.fa-json-box[readonly]').value.includes('81')");
  await b.evaluate("document.querySelector('.fa-task-step .btn-primary').click()");
  await b.wait("document.querySelector('.fa-next-package') || document.querySelectorAll('.fa-task-step button').length>=3");
  await b.evaluate(`document.querySelector('.fa-json-box:not([readonly])').value=JSON.stringify({rows:[{adviceId:'81',personId:'42',systemVersion:2,gptAdvice:{overallStrategy:'保持双向确认。',productServiceAdvice:'来源核验后再介绍。',strategySourceIds:[],productSourceIds:[]}}]});
   [...document.querySelectorAll('.fa-task-step button')].find(x=>x.textContent.includes('校验并生成预览'))?.click()`);
  await b.wait("document.querySelector('.fa-preview-row .btn-primary')");
  assert.equal(await b.evaluate("window.faCalls.some(x=>x.preview)") ,true);
  await b.evaluate("document.querySelector('.fa-preview-row .btn-primary').click()");
  await b.wait("window.faCalls.some(x=>x.confirm)");
  assert.equal((await b.evaluate("window.faCalls.find(x=>x.confirm).confirm.confirmed")),true);
  await b.evaluate("(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');window.faRender()})()");
  await b.wait("document.querySelectorAll('.fa-lane').length===2");
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.fa-lane-head h3')].map(x=>x.textContent)"),['CloudBase AI','GPT']);
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.fa-section h4')].map(x=>x.textContent)"),
    ['Overall Follow-up Strategy','Product and Service Advice','Overall Follow-up Strategy','Product and Service Advice']);
  await b.healthy();
 }finally{await b.close();}
});
