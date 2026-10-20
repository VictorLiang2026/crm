'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const misc=fs.readFileSync('crm/js/modules/console/pages/misc.js','utf8');
const i18n=fs.readFileSync('crm/js/modules/console/i18n.js','utf8');
const assistant=fs.readFileSync('cloudfunctions/assistant/index.js','utf8');
const router=fs.readFileSync('cloudfunctions/assistant/intent-router.js','utf8');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('AI page offers read-only tasks, intent choice, Person choice, scope and source display',()=>{
  assert.match(misc,/response\.ok !== true/);
  for(const token of ['assistantTaskPanel','data.assistantReadTask','needs_intent_choice','needs_person_selection',
    'assistant_task_scope_label','assistant_task_readonly','result.sources','search_v2_condition_']) assert.ok(misc.includes(token),token);
  for(const key of ['assistant_task_title','assistant_task_choose_intent','assistant_task_person_choice',
    'assistant_task_analyze_unsupported','assistant_intent_search','assistant_intent_summarize','assistant_intent_prepare','assistant_intent_plan']) {
    assert.ok(i18n.includes(`'${key}'`),`missing ${key}`);
    const start=i18n.indexOf(`'${key}'`), line=i18n.slice(start,i18n.indexOf('\n',start));
    assert.match(line,/'zh-CN':/); assert.match(line,/'en':/);
  }
  assert.doesNotMatch(misc,/innerHTML\s*=/);
});

test('new action is separate and old routes retain their existing branches',()=>{
  for(const action of ['assistantReadTask','searchV2','summarize','meetingPrep','conversationPlaybook','personAIHistory']) assert.ok(assistant.includes(`event?.action === '${action}'`),action);
  assert.match(router,/status:\s*'routed'/); assert.match(router,/businessDataRead:\s*false/);
});

test('assistant task UI confirms intent and Person, renders sourced results on iPad in both languages',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try {
    await browser.start(); await browser.openConsole('#/ai','authCase=1');
    await browser.wait("document.querySelector('.console-main')");
    await browser.evaluate(`(async()=>{
      const {renderAI}=await import('/crm/js/modules/console/pages/misc.js');
      const {data}=await import('/crm/js/modules/console/data.js');
      const i18n=await import('/crm/js/modules/console/i18n.js');
      window.taskCalls=[];
      data.assistantReadTask=async(_ctx,p)=>{
        window.taskCalls.push(p);
        if(p.query.includes('plan')) return {ok:true,status:'complete',intent:'plan',plan:{intent:'plan',interpretation:'Today plan',dataScope:'today read-only overview'},execution:{performed:true,modelCalled:true,businessDataRead:true,businessDataWritten:false},result:{view:'morning',sections:{morningBrief:{headline:'Today priorities',guidance:'Review before contact'},topActions:[{title:'Check source',whyNow:'Due today',source:'public.actions #8'}]},testData:{containsTestData:false}}};
        if(!p.selectedIntent) return {ok:true,status:'needs_intent_choice',plan:{intent:'unsupported'},options:['summarize','prepare'],requiresHumanDecision:true};
        if(!p.selectedPersonId) return {ok:true,status:'needs_person_selection',plan:{intent:p.selectedIntent},candidates:[{id:'783',displayName:'【系统测试·勿联系】虚构人物甲'}],requiresHumanDecision:true};
        return {ok:true,status:'complete',intent:p.selectedIntent,plan:{intent:p.selectedIntent,interpretation:'Person summary',dataScope:'one selected Person'},execution:{performed:true,modelCalled:true,businessDataRead:true,businessDataWritten:false},result:{personId:'783',personName:'【系统测试·勿联系】虚构人物甲',summary:'Safe text <img src=x onerror=alert(1)>',sources:[{schema:'public',table:'persons',id:'783'}],signals:[],gaps:[],nextActions:[]}};
      };
      window.aiI18n=i18n;window.renderTestAI=()=>renderAI({main:document.querySelector('.console-main'),toast:()=>{}});window.renderTestAI();
    })()`);
    await browser.wait("document.querySelector('.console-main textarea')");
    await browser.evaluate(`(()=>{const q=document.querySelector('.console-main textarea');q.value='总结虚构人物甲';document.querySelector('.console-main form').requestSubmit()})()`);
    await browser.wait("document.querySelector('.console-main button') && document.querySelector('.console-main').innerText.includes('我不确定')");
    await browser.evaluate("[...document.querySelectorAll('.console-main button')].find(x=>x.textContent.trim()==='人物摘要').click()");
    await browser.wait("document.querySelector('.console-main select')");
    await browser.evaluate("(()=>{const s=document.querySelector('.console-main select');s.value='783';[...document.querySelectorAll('.console-main button')].find(x=>x.textContent.trim()==='确认').click()})()");
    await browser.wait("document.querySelector('.console-main').innerText.includes('public.persons #783')");
    const zh=await browser.evaluate("({text:document.querySelector('.console-main').innerText,images:document.querySelectorAll('.console-main img').length,calls:window.taskCalls})");
    assert.match(zh.text,/虚构人物甲/);assert.equal(zh.images,0);assert.equal(zh.calls.length,3);
    assert.equal(zh.calls[0].selectedPersonId,undefined);assert.equal(zh.calls[2].selectedPersonId,'783');
    await browser.evaluate("window.aiI18n.setLang('en');window.renderTestAI();");
    await browser.wait("document.querySelector('.console-main textarea')");
    await browser.evaluate("(()=>{const q=document.querySelector('.console-main textarea');q.value='today plan';document.querySelector('.console-main form').requestSubmit()})()");
    await browser.wait("document.querySelector('.console-main').innerText.includes('Today priorities')");
    const en=await browser.evaluate("document.querySelector('.console-main').innerText");
    assert.match(en,/Read-only Tasks/);assert.match(en,/Data scope/);assert.match(en,/Today priorities/);assert.match(en,/public\.actions #8/);
    for(const [width,height] of [[1180,820],[820,1180]]) { await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false}); assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height}`); }
    await browser.send('Emulation.clearDeviceMetricsOverride');
  } finally { await browser.close(); }
});
