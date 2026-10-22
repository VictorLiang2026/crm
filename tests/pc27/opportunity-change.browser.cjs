'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('admin.html exposes the Opportunity Assistant route from the AI hub',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try{
    await browser.start();await browser.open('#/ai');
    await browser.wait("document.querySelector('a[href=\"#/assistant/opportunities/change\"]')");
    await browser.evaluate("document.querySelector('a[href=\"#/assistant/opportunities/change\"]').click()");
    await browser.wait("document.querySelector('.crm-opp-change h2')?.innerText.includes('修改或结束经营机会')");
    await browser.healthy();
  }finally{await browser.close();}
});

test('Opportunity update and close require manual targets, result note, verified preview and separate execute in both iPad layouts',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try {
    await browser.start();await browser.openConsole('#/ai','authCase=1');
    await browser.wait("document.querySelector('.console-main')");
    await browser.evaluate("location.hash='#/assistant/opportunities/change'");
    await new Promise(resolve=>setTimeout(resolve,300));
    await browser.evaluate(`(async()=>{
      const {renderAssistantOpportunityChange}=await import('/crm/js/modules/assistant-opportunity-change.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      window.oppCalls=[];
      const original={type:'insurance',status:'沟通',progress:'Initial review',nextAction:'Check documents',nextActionDate:'2026-10-23'};
      window.oppCallFn=async(name,p)=>{window.oppCalls.push({name,p});if(name!=='assistant')return {error:'unexpected'};
        if(p.action==='opportunityCommandInterpret')return {ok:true,status:'needs_person_selection',proposal:{operation:window.closeMode?'close':'edit',interpretation:window.closeMode?'Close selected Opportunity':'Update next step',personMention:'Fictional Alex',opportunityMention:'renewal',changes:window.closeMode?{status:'关闭'}:{nextAction:'Call on Friday'}} ,candidates:[{id:'783',displayName:'【系统测试·勿联系】虚构人物甲'},{id:'784',displayName:'【系统测试·勿联系】虚构人物乙'}]};
        if(p.action==='opportunityCommandTargets')return {ok:true,status:'targets_available',person:{id:'783',displayName:'【系统测试·勿联系】虚构人物甲'},opportunities:[{id:501,opportunity_type:'insurance',status:'沟通',next_action:'Check documents'}],testData:{status:'verified',containsTestData:true}};
        if(p.stage==='plan')return {ok:true,status:'planned',commandId:'00000000-0000-4000-8000-000000000001'};
        if(p.stage==='preview')return {ok:true,status:'previewed',previewHash:'0123456789abcdef0123456789abcdef',expiresAt:'2026-10-17T10:15:00Z',preview:{before:original,after:window.closeMode?{...original,status:'关闭'}:{...original,nextAction:'Call on Friday'},outcomeCreated:window.closeMode,outcomeType:'opportunity_closed',outcomeResult:window.closeMode?'【系统测试·勿联系】Fictional test close result':null}};
        if(p.stage==='confirm')return {ok:true,status:'confirmed'};
        if(p.stage==='execute')return {ok:true,status:'executed',opportunityId:501};};
      window.renderOppChange=(lang='zh-CN')=>{setLang(lang);renderAssistantOpportunityChange({root:document.querySelector('.console-main'),callFn:window.oppCallFn});};
      window.renderOppChange();
    })()`);
    await browser.wait("document.querySelector('.crm-opp-change textarea')");
    await browser.evaluate(`(()=>{const root=document.querySelector('.crm-opp-change');root.querySelector('form').querySelector('textarea').value='Update the renewal next step';root.querySelector('form').requestSubmit()})()`);
    await browser.wait("document.querySelectorAll('.crm-opp-change-choices button').length===2");
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-choices button')[0].click()");
    await browser.wait("document.querySelectorAll('.crm-opp-change-choices button').length===3");
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-choices button')[2].click()");
    await browser.wait("!document.querySelector('.crm-opp-change-controls button').disabled");
    assert.match(await browser.evaluate("document.querySelector('.crm-opp-change-test-notice').innerText"),/勿联系|do not contact/);
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-controls button')[0].click()");
    await browser.wait("document.querySelector('.crm-opp-change-controls button:nth-child(2)').disabled===false");
    assert.match(await browser.evaluate("document.querySelector('.crm-opp-change-notice').innerText"),/变更计划已生成，请读取服务端预览/);
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-controls button')[1].click()");
    await browser.wait("document.querySelector('.crm-opp-change-preview').innerText.includes('变更前')");
    const edit=await browser.evaluate(`({text:document.querySelector('.crm-opp-change-preview').innerText,
      executeDisabled:document.querySelectorAll('.crm-opp-change-controls button')[3].disabled,
      executeCalls:window.oppCalls.filter(x=>x.p.stage==='execute').length,
      targetCalls:window.oppCalls.filter(x=>x.p.action==='opportunityCommandTargets').map(x=>x.p.selectedPersonId)})`);
    assert.match(edit.text,/Check documents/);assert.match(edit.text,/Call on Friday/);assert.equal(edit.executeDisabled,true);assert.equal(edit.executeCalls,0);assert.deepEqual(edit.targetCalls,['783']);
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-controls button')[2].click()");
    await browser.wait("document.querySelectorAll('.crm-opp-change-controls button')[3].disabled===false");
    assert.equal(await browser.evaluate("window.oppCalls.filter(x=>x.p.stage==='execute').length"),0);
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-controls button')[3].click()");
    await browser.wait("document.querySelector('.crm-opp-change-notice').innerText.includes('机会变更已完成')");
    assert.equal(await browser.evaluate("window.oppCalls.filter(x=>x.p.stage==='execute').length"),1);

    await browser.evaluate("window.closeMode=true;window.renderOppChange('en');document.querySelector('.crm-opp-change-query textarea').value='Close Fictional Alex renewal';document.querySelector('.crm-opp-change-request').requestSubmit()");
    await browser.wait("document.querySelectorAll('.crm-opp-change-choices button').length===2");
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-choices button')[0].click()");
    await browser.wait("document.querySelectorAll('.crm-opp-change-choices button').length===3");
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-choices button')[2].click()");
    assert.equal(await browser.evaluate("document.querySelector('.crm-opp-change-controls button').disabled"),true,'close requires a human outcome note and status');
    await browser.evaluate("document.querySelector('.crm-opp-change-close-fields select').value='关闭';document.querySelector('.crm-opp-change-close-fields textarea').value='【系统测试·勿联系】Fictional test close result';document.querySelector('.crm-opp-change-close-fields textarea').dispatchEvent(new Event('input',{bubbles:true}))");
    await browser.wait("document.querySelector('.crm-opp-change-controls button').disabled===false");
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-controls button')[0].click()");
    await browser.wait("document.querySelector('.crm-opp-change-controls button:nth-child(2)').disabled===false");
    assert.match(await browser.evaluate("document.querySelector('.crm-opp-change-notice').innerText"),/Change plan ready\. Load the server preview/);
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-controls button')[1].click()");
    await browser.wait("document.querySelector('.crm-opp-change-preview').innerText.includes('Opportunity closed')");
    const closePreview=await browser.evaluate("document.querySelector('.crm-opp-change-preview').innerText");
    assert.match(closePreview,/Fictional test close result/);assert.match(closePreview,/Opportunity closed/);assert.match(closePreview,/Confirmation expires/);
    assert.equal(await browser.evaluate("window.oppCalls.filter(x=>x.p.stage==='execute').length"),1);
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-controls button')[2].click()");
    await browser.wait("document.querySelectorAll('.crm-opp-change-controls button')[3].disabled===false");
    assert.equal(await browser.evaluate("window.oppCalls.filter(x=>x.p.stage==='execute').length"),1);
    await browser.evaluate("document.querySelectorAll('.crm-opp-change-controls button')[3].click()");
    await browser.wait("document.querySelector('.crm-opp-change-notice').innerText.includes('The Opportunity change is complete')");
    assert.equal(await browser.evaluate("window.oppCalls.filter(x=>x.p.stage==='execute').length"),2);
    assert.match(await browser.evaluate("document.querySelector('.crm-opp-change h2').innerText"),/Update or close/);
    assert.match(await browser.evaluate("document.querySelector('.crm-opp-change').innerText"),/Change request/);
    for(const [width,height] of [[1180,820],[820,1180]]){await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height}`);}
    await browser.send('Emulation.clearDeviceMetricsOverride');
  } finally {await browser.close();}
});
