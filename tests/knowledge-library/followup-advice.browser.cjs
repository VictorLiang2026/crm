'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('follow-up advice generates one CloudBase lane and manages each model independently',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.openConsole('#/people','authCase=1');
  await b.wait("document.querySelector('.console-main')");
  await b.send('Emulation.setDeviceMetricsOverride',{width:768,height:1024,deviceScaleFactor:2,mobile:false});
  await b.evaluate(`(async()=>{
   const {data}=await import('/crm/js/modules/console/data.js');
   const advice={id:'81',personId:'42',title:'退休规划回访',updatedAt:'2026-10-31T01:00:00.000Z',
    system:{title:'退休规划回访',status:'ready',version:2,strategy:'先确认客户近期目标，再约定复盘。',productAdvice:'核实需求后再介绍适配服务。',
      messageDraft:'您好，方便时想和您确认一下近期安排。',strategySources:[],productSources:[]},
    gpt:{title:'退休准备复盘',status:'stale',basedOnSystemVersion:1,strategy:'先确认目标。',productAdvice:'待进一步核实。',messageDraft:'',strategySources:[],productSources:[]}};
   window.faAdvice=advice;window.faCalls=[];
   window.confirm=()=>true;
   advice.gpt.messageDraft='GPT版：您好，方便时我们可以继续聊聊。';
   const older=[...Array.from({length:24},(_,i)=>({id:String(100+i),personId:'42',title:'历史建议',updatedAt:'2026-10-01T00:00:00.000Z',
    system:{status:'ready',version:1,messageDraft:'',strategy:'',productAdvice:''},gpt:{status:'pending',messageDraft:''}})),
    {id:'200',personId:'42',title:'更早的 GPT 话术',updatedAt:'2026-09-01T00:00:00.000Z',system:{status:'ready',version:1,messageDraft:''},
     gpt:{title:'更早的 GPT 话术',status:'manual',basedOnSystemVersion:1,messageDraft:'历史 GPT 微信话术'}}];
   data.followupAdviceList=async(_ctx,_person,page={})=>{const all=[advice,...older],offset=page.offset||0,limit=page.limit||100;
    if(page.limit===25)return {rows:all.slice(offset,offset+limit),limit,offset,hasMore:offset+limit<all.length};
    return {rows:[advice],limit,offset,hasMore:false};};data.dualFollowupHistory=async()=>({rows:[]});
   data.updateFollowupAdvice=async(_ctx,payload)=>{window.faCalls.push({update:payload});
    advice.system.title=payload.title;advice.system.strategy=payload.strategy;advice.system.productAdvice=payload.productAdvice;
    advice.system.messageDraft=payload.messageDraft;
    if(payload.gptAction==='edit'){advice.gpt.title=payload.gptTitle;advice.gpt.strategy=payload.gptStrategy;
     advice.gpt.productAdvice=payload.gptProductAdvice;advice.gpt.messageDraft=payload.gptMessageDraft;}
    return {ok:true};};
   data.deleteFollowupAdvice=async(_ctx,payload)=>{window.faCalls.push({delete:payload});return {ok:true};};
   data.generateFollowupAdvice=async(_ctx,payload)=>{window.faCalls.push({generate:payload});return {ok:true};};
   const {renderFollowupAdvice,renderFollowupAdviceTasks}=await import('/crm/js/modules/console/followup-advice.js');
   const ctx={main:document.querySelector('.console-main'),api:{call:async()=>({ok:true,rows:[]})}};
   window.faCtx=ctx;window.faRender=()=>renderFollowupAdvice(ctx,'42');
   window.faRenderTasks=()=>renderFollowupAdviceTasks(ctx);window.faRender();window.faData=data;
  })()`);
  await b.wait("document.querySelectorAll('.fa-lane').length===2");
  const actions=await b.evaluate("[...document.querySelectorAll('.page-head .head-actions button')].map(x=>x.textContent.trim())");
  assert.match(actions[0],/沟通话术/);assert.match(actions[1],/生成跟进建议/);
  await b.evaluate("document.querySelector('.page-head .head-actions button').click()");
  await b.wait("document.querySelector('.fa-scripts-modal .fa-script-card')");
  const scriptView=await b.evaluate("({text:document.querySelector('.fa-scripts-modal').textContent,cards:document.querySelectorAll('.fa-script-card').length,lanes:[...document.querySelectorAll('.fa-script-compare .fa-lane-head h3')].map(x=>x.textContent),content:[...document.querySelectorAll('.fa-script-compare .fa-script-text')].map(x=>x.textContent),columns:getComputedStyle(document.querySelector('.fa-script-compare')).gridTemplateColumns})");
  assert.equal(scriptView.cards,1);assert.deepEqual(scriptView.lanes,['CloudBase沟通话术','GPT沟通话术']);
  assert.equal(scriptView.columns.trim().split(/\s+/).length,2,'iPad portrait keeps the two script columns side by side');
  assert.deepEqual(scriptView.content,['您好，方便时想和您确认一下近期安排。','GPT版：您好，方便时我们可以继续聊聊。']);
  assert.match(scriptView.text,/退休准备复盘/);
  assert.doesNotMatch(scriptView.text,/先确认客户近期目标|核实需求后再介绍/);
  assert.equal(await b.evaluate("document.querySelectorAll('.fa-scripts-modal .fa-script-card button').length"),0);
  assert.equal(await b.evaluate("document.querySelector('.fa-script-page').textContent"),'第 1 页');
  assert.equal(await b.evaluate("document.querySelector('.fa-script-pager button:last-child').disabled"),false);
  await b.evaluate("document.querySelector('.fa-script-pager button:last-child').click()");
  await b.wait("document.querySelector('.fa-script-text')?.textContent==='历史 GPT 微信话术'");
  assert.equal(await b.evaluate("document.querySelectorAll('.fa-script-card').length"),1);
  assert.equal(await b.evaluate("document.querySelectorAll('.fa-script-compare .fa-lane').length"),2);
  assert.equal(await b.evaluate("document.querySelector('.fa-script-compare .fa-lane-system .fa-script-empty')?.textContent"),'暂无已保存的微信沟通话术。');
  assert.equal(await b.evaluate("document.querySelector('.fa-script-page').textContent"),'第 2 页');
  assert.equal(await b.evaluate("document.querySelector('.fa-script-pager button:first-child').disabled"),false);
  await b.evaluate("document.querySelector('.fa-script-pager button:first-child').click()");
  await b.wait("document.querySelectorAll('.fa-script-card').length===1");
  await b.evaluate("document.querySelector('.fa-scripts-modal .btn-ghost').click()");
  const parallel=await b.evaluate(`({lanes:[...document.querySelectorAll('.fa-lane-head h3')].map(n=>n.textContent),sections:[...document.querySelectorAll('.fa-section h4')].map(n=>n.textContent),titles:[...document.querySelectorAll('.fa-lane-title')].map(n=>n.textContent),gptStatus:document.querySelector('.fa-lane-gpt .fa-status-stale')?.textContent})`);
  assert.deepEqual(parallel.lanes,['CloudBase AI','GPT']);
  assert.deepEqual(parallel.sections,['整体跟进策略','产品与服务建议','微信沟通话术','整体跟进策略','产品与服务建议','微信沟通话术']);
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
  await b.evaluate("document.querySelector('.page-head .head-actions button').click()");
  await b.wait("document.querySelector('.fa-scripts-modal .fa-script-card')");
  assert.equal(await b.evaluate("document.querySelectorAll('.fa-script-compare .fa-script-text')[0].textContent"),'更新后的微信话术');
  await b.evaluate("document.querySelector('.fa-scripts-modal .btn-ghost').click()");
  await b.evaluate("document.querySelector('.fa-row-edit').click()");
  await b.wait("document.querySelector('.fa-modal .fa-edit-policy-select')");
  await b.evaluate(`(()=>{const select=document.querySelector('.fa-modal .fa-edit-policy-select');select.value='edit';select.dispatchEvent(new Event('change',{bubbles:true}));
   const fields=[...document.querySelectorAll('.fa-modal label')];const field=label=>fields.find(x=>x.querySelector('span')?.textContent.includes(label))?.querySelector('textarea');
   field('GPT：微信沟通话术').value='更新后的 GPT 微信话术';document.querySelector('.fa-modal .btn-primary').click()})()`);
  await b.wait("window.faCalls.some(x=>x.update?.gptMessageDraft==='更新后的 GPT 微信话术')");
  await b.evaluate("document.querySelector('.page-head .head-actions button').click()");
  await b.wait("document.querySelectorAll('.fa-scripts-modal .fa-script-card').length===1");
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.fa-script-compare .fa-script-text')].map(x=>x.textContent)"),['更新后的微信话术','更新后的 GPT 微信话术']);
  await b.evaluate("document.querySelector('.fa-scripts-modal .btn-ghost').click()");
  await b.evaluate("document.querySelector('.fa-row-edit').click()");
  await b.wait("document.querySelector('.fa-modal .fa-edit-policy-select')");
  await b.evaluate("document.querySelector('.fa-modal .fa-edit-policy-select').value='delete';document.querySelector('.fa-modal .btn-primary').click()");
  await b.wait("window.faCalls.filter(x=>x.update?.lane==='pair').length===3");
  assert.equal(await b.evaluate("window.faCalls.filter(x=>x.update?.lane==='pair')[2].update.gptAction"),'delete');
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
  assert.match(await b.evaluate("document.querySelector('.page-head').textContent"),/Communication Scripts/);
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
