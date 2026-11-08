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
    system:{title:'退休规划回访',status:'ready',version:2,strategy:'先确认客户近期目标，再约定复盘。',productAdvice:'核实需求后再介绍适配服务。',
      messageDraft:'您好，方便时想和您确认一下近期安排。',strategySources:[],productSources:[]},
    gpt:{title:'退休准备复盘',status:'stale',basedOnSystemVersion:1,strategy:'先确认目标。',productAdvice:'待进一步核实。',messageDraft:'',strategySources:[],productSources:[]}};
   window.faAdvice=advice;window.faCalls=[];
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
  assert.deepEqual(parallel.sections,['整体跟进策略','产品与服务建议','微信沟通话术','整体跟进策略','产品与服务建议']);
  assert.deepEqual(parallel.titles,['退休规划回访','退休准备复盘']);
  assert.match(parallel.gptStatus,/系统版已更新/);
  assert.equal(await b.evaluate("document.querySelectorAll('.fa-row-head .fa-row-actions button').length"),2);
  assert.equal(await b.evaluate("document.querySelectorAll('.fa-lane .fa-row-actions').length"),0);
  await b.evaluate("document.querySelector('.fa-row-edit').click()");
  await b.wait("document.querySelector('.fa-modal input')");
  await b.evaluate("document.querySelector('.fa-modal input').value='更新后的系统标题';document.querySelectorAll('.fa-modal textarea')[2].value='更新后的微信话术';document.querySelector('.fa-modal .fa-edit-policy-select').value='edit';document.querySelector('.fa-modal .fa-edit-policy-select').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.fa-modal .fa-edit-policy-select').value='keep';document.querySelector('.fa-modal .fa-edit-policy-select').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.fa-modal .btn-primary').click()");
  await b.wait("window.faCalls.some(x=>x.update?.lane==='pair')");
  assert.equal(await b.evaluate("window.faCalls.find(x=>x.update)?.update.title"),'更新后的系统标题');
  assert.equal(await b.evaluate("window.faCalls.find(x=>x.update)?.update.messageDraft"),'更新后的微信话术');
  assert.equal(await b.evaluate("window.faCalls.find(x=>x.update)?.update.gptAction"),'keep');
  await b.evaluate("document.querySelector('.fa-row-edit').click()");
  await b.wait("document.querySelector('.fa-modal .fa-edit-policy-select')");
  await b.evaluate("document.querySelector('.fa-modal .fa-edit-policy-select').value='delete';document.querySelector('.fa-modal .btn-primary').click()");
  await b.wait("window.faCalls.filter(x=>x.update?.lane==='pair').length===2");
  assert.equal(await b.evaluate("window.faCalls.filter(x=>x.update?.lane==='pair')[1].update.gptAction"),'delete');
  await b.evaluate("document.querySelector('.fa-row-delete').click()");
  await b.wait("window.faCalls.some(x=>x.delete)");
  assert.equal(await b.evaluate("window.faCalls.find(x=>x.delete).delete.id"),'81');
  await b.evaluate("document.querySelector('.page-head .btn-primary').click()");
  await b.wait("window.faCalls.some(x=>x.generate)");
  const generate=await b.evaluate("window.faCalls.find(x=>x.generate).generate");
  assert.equal(generate.personId,'42');assert.equal('title' in generate,false);assert.equal('focus' in generate,false);
  await b.evaluate("window.faAdvice.gpt={title:'',status:'pending',basedOnSystemVersion:null,strategy:'',productAdvice:'',strategySources:[],productSources:[]};window.faRender()");
  await b.wait("document.querySelector('.fa-lane-gpt .fa-lane-empty')");
  await b.evaluate("document.querySelector('.fa-row-edit').click()");
  await b.wait("document.querySelector('.fa-modal')");
  assert.equal(await b.evaluate("document.querySelectorAll('.fa-modal .fa-edit-fields').length"),0);
  assert.match(await b.evaluate("document.querySelector('.fa-modal').textContent"),/GPT.*SKILL/);
  await b.evaluate("document.querySelector('.fa-modal .btn-ghost').click()");
  await b.evaluate("window.faAdvice.gpt={title:'GPT 英文标题',status:'stale',basedOnSystemVersion:1,strategy:'先确认目标。',productAdvice:'待进一步核实。',strategySources:[],productSources:[]}");
  await b.evaluate('window.faRenderTasks()');
  await b.wait("document.querySelector('.fa-empty')");
  assert.match(await b.evaluate("document.querySelector('.fa-empty').textContent"),/SKILL 尚未接入/);
  await b.evaluate("(async()=>{const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');window.faRender()})()");
  await b.wait("document.querySelectorAll('.fa-lane').length===2");
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.fa-section h4')].map(x=>x.textContent)"),
    ['Overall Follow-up Strategy','Product and Service Advice','WeChat Message Draft','Overall Follow-up Strategy','Product and Service Advice']);
  await b.evaluate("window.faAdvice.system.status='failed';window.faRender()");
  await b.wait("document.querySelector('.fa-status-failed')");
  assert.equal(await b.evaluate("document.querySelectorAll('.fa-row-head .fa-row-delete').length"),1,
    'failed generated advice has a delete action');
  assert.equal(await b.evaluate("document.querySelectorAll('.fa-row-head .fa-row-edit').length"),0,
    'failed advice cannot be edited as generated content');
  await b.evaluate("document.querySelector('.fa-row-delete').click()");
  await b.wait("window.faCalls.some(x=>x.delete)");
  assert.equal(await b.evaluate("window.faCalls.find(x=>x.delete).delete.updatedAt"),'2026-10-31T01:00:00.000Z');
  await b.evaluate(`(async()=>{
   const error=new Error('TEST_DATA_SCOPE_UNVERIFIED');error.code='TEST_DATA_SCOPE_UNVERIFIED';
   window.faData.generateFollowupAdvice=async()=>{window.faErrorCalled=true;throw error};window.faRender();
   document.querySelector('.page-head .btn-primary').click();
  })()`);
  await b.wait("window.faErrorCalled===true");
  await b.wait("document.querySelectorAll('.fa-page-status')[1]?.textContent.includes('Knowledge source safety')");
  assert.match(await b.evaluate("document.querySelectorAll('.fa-page-status')[1].textContent"),/Knowledge source safety/);
  await b.evaluate(`(async()=>{
   const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('zh-CN');
   window.faRender();document.querySelector('.page-head .btn-primary').click();
  })()`);
  await b.wait("document.querySelectorAll('.fa-page-status')[1]?.textContent.includes('知识来源安全状态')");
  assert.match(await b.evaluate("document.querySelectorAll('.fa-page-status')[1].textContent"),/知识来源安全状态/);
  await b.evaluate(`(async()=>{
   const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('en');
   window.faRender();document.querySelector('.page-head .btn-primary').click();
  })()`);
  await b.wait("document.querySelectorAll('.fa-page-status')[1]?.textContent.includes('could not be verified')");
  assert.match(await b.evaluate("document.querySelectorAll('.fa-page-status')[1].textContent"),/could not be verified/);
  const apiCode=await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');
   try{await data.knowledgeLibrary({api:{call:async()=>({error:{code:'TEST_DATA_SCOPE_UNVERIFIED',message:'safe'}})}},'list')}
   catch(error){return error.code||''}return '';
  })()`);
  assert.equal(apiCode,'TEST_DATA_SCOPE_UNVERIFIED','API error code reaches UI error handler');
  await b.healthy();
 }finally{await b.close();}
});
