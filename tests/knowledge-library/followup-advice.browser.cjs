'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('follow-up advice generates one CloudBase lane and manages each model independently',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/people','authCase=1');
  await b.wait("document.querySelector('.console-main')");
  await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');
   const advice={id:'81',personId:'42',title:'退休规划回访',updatedAt:'2026-10-31T01:00:00.000Z',
    system:{title:'退休规划回访',status:'ready',version:2,strategy:'先确认客户近期目标，再约定复盘。',productAdvice:'核实需求后再介绍适配服务。',strategySources:[],productSources:[]},
    gpt:{title:'退休准备复盘',status:'stale',basedOnSystemVersion:1,strategy:'先确认目标。',productAdvice:'待进一步核实。',strategySources:[],productSources:[]}};
   window.faCalls=[];
   window.confirm=()=>true;
   data.followupAdviceList=async()=>({rows:[advice]});data.dualFollowupHistory=async()=>({rows:[]});
   data.updateFollowupAdvice=async(_ctx,payload)=>{window.faCalls.push({update:payload});return {ok:true};};
   data.deleteFollowupAdvice=async(_ctx,payload)=>{window.faCalls.push({delete:payload});return {ok:true};};
   data.generateFollowupAdvice=async(_ctx,payload)=>{window.faCalls.push({generate:payload});return {ok:true};};
   const {renderFollowupAdvice,renderFollowupAdviceTasks}=await import('/crm/js/modules/console/followup-advice.js');
   const ctx={main:document.querySelector('.console-main'),api:{call:async()=>({ok:true,rows:[]})}};
   window.faCtx=ctx;window.faRender=()=>renderFollowupAdvice(ctx,'42');
   window.faRenderTasks=()=>renderFollowupAdviceTasks(ctx);window.faRender();window.faData=data;
  })()`);
  await b.wait("document.querySelectorAll('.fa-lane').length===2");
  const parallel=await b.evaluate(`({lanes:[...document.querySelectorAll('.fa-lane-head h3')].map(n=>n.textContent),sections:[...document.querySelectorAll('.fa-section h4')].map(n=>n.textContent),titles:[...document.querySelectorAll('.fa-lane-title')].map(n=>n.textContent),gptStatus:document.querySelector('.fa-lane-gpt .fa-status-stale')?.textContent})`);
  assert.deepEqual(parallel.lanes,['CloudBase AI','GPT']);
  assert.deepEqual(parallel.sections,['整体跟进策略','产品与服务建议','整体跟进策略','产品与服务建议']);
  assert.deepEqual(parallel.titles,['退休规划回访','退休准备复盘']);
  assert.match(parallel.gptStatus,/系统版已更新/);
  await b.evaluate("document.querySelector('.fa-lane-system .fa-row-actions .btn-ghost').click()");
  await b.wait("document.querySelector('.fa-modal input')");
  await b.evaluate("document.querySelector('.fa-modal input').value='更新后的系统标题';document.querySelector('.fa-modal .btn-primary').click()");
  await b.wait("window.faCalls.some(x=>x.update?.lane==='system')");
  assert.equal(await b.evaluate("window.faCalls.find(x=>x.update)?.update.title"),'更新后的系统标题');
  await b.evaluate("document.querySelectorAll('.fa-lane-gpt .fa-row-actions .btn-ghost')[1].click()");
  await b.wait("window.faCalls.some(x=>x.update?.lane==='gpt'&&x.update.action==='delete')");
  await b.evaluate("document.querySelector('.page-head .btn-primary').click()");
  await b.wait("window.faCalls.some(x=>x.generate)");
  const generate=await b.evaluate("window.faCalls.find(x=>x.generate).generate");
  assert.equal(generate.personId,'42');assert.equal('title' in generate,false);assert.equal('focus' in generate,false);
  await b.evaluate('window.faRenderTasks()');
  await b.wait("document.querySelector('.fa-empty')");
  assert.match(await b.evaluate("document.querySelector('.fa-empty').textContent"),/SKILL 尚未接入/);
  await b.evaluate("(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');window.faRender()})()");
  await b.wait("document.querySelectorAll('.fa-lane').length===2");
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.fa-section h4')].map(x=>x.textContent)"),
    ['Overall Follow-up Strategy','Product and Service Advice','Overall Follow-up Strategy','Product and Service Advice']);
  await b.healthy();
 }finally{await b.close();}
});
