'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('Action update and close UI requires Person, exact Action, verified preview and explicit execute in both iPad layouts',async()=>{
  const browser=new Browser(path.resolve(__dirname,'../..'));
  try {
    await browser.start(); await browser.openConsole('#/ai','authCase=1');
    await browser.wait("document.querySelector('.console-main')");
    await browser.evaluate("location.hash='#/assistant/actions/change'");
    await new Promise(resolve=>setTimeout(resolve,300));
    await browser.evaluate(`(async()=>{
      const {renderAssistantActionChange}=await import('/crm/js/modules/assistant-action-change.js');
      const {setLang}=await import('/crm/js/modules/console/i18n.js');
      window.changeCalls=[];
      const original={action_type:'followup',title:'Review renewal',description:'Call next week',due_at:'2026-10-23T09:00:00+08:00',priority:'medium',status:'open'};
      window.changeCallFn=async(name,p)=>{window.changeCalls.push({name,p});
        if(name!=='assistant')return {error:'unexpected'};
        if(p.action==='actionCommandInterpret')return {ok:true,status:'needs_person_selection',proposal:{operation:window.closeMode?'close':'update',interpretation:window.closeMode?'Complete the selected Action':'Move the review and raise priority',personMention:'Fictional Alex',actionMention:'review renewal',changes:window.closeMode?{action_type:null,title:null,description:null,due_at:null,priority:null}:{action_type:null,title:'Review renewal',description:null,due_at:'2026-10-30T17:00:00+08:00',priority:'high'}} ,candidates:[{id:'783',displayName:'【系统测试·勿联系】虚构人物甲'},{id:'784',displayName:'【系统测试·勿联系】虚构人物乙'}]};
        if(p.action==='actionCommandTargets')return {ok:true,status:'targets_available',person:{id:'783',displayName:'【系统测试·勿联系】虚构人物甲'},actions:[{id:501,title:'Review renewal',status:'open'}],testData:{status:'verified',containsTestData:true}};
        if(p.stage==='plan')return {ok:true,status:'planned',commandId:'00000000-0000-4000-8000-000000000001'};
        if(p.stage==='preview')return {ok:true,status:'previewed',previewHash:'0123456789abcdef0123456789abcdef',expiresAt:'2026-10-17T10:15:00Z',preview:{before:original,after:window.closeMode?{...original,status:'completed',completed_at:'2026-10-17T10:00:00Z',completed_by_uid:'fixture-user'}:{...original,title:'Review renewal',due_at:'2026-10-30T17:00:00+08:00',priority:'high'}}};
        if(p.stage==='confirm')return {ok:true,status:'confirmed'};
        if(p.stage==='execute')return {ok:true,status:'executed',actionId:501};
      };
      window.renderActionChange=(lang='zh-CN')=>{setLang(lang);renderAssistantActionChange({root:document.querySelector('.console-main'),callFn:window.changeCallFn});};
      window.renderActionChange();
    })()`);
    await browser.wait("document.querySelector('.console-main textarea')");
    await browser.evaluate(`(()=>{const root=document.querySelector('.console-main');root.querySelector('textarea').value='Move the renewal review and set high priority';root.querySelector('form').requestSubmit()})()`);
    await browser.wait("document.querySelectorAll('.crm-action-change-choices button').length===2");
    await browser.evaluate("document.querySelectorAll('.crm-action-change-choices button')[0].click()");
    await browser.wait("document.querySelectorAll('.crm-action-change-choices button').length===3");
    await browser.evaluate("document.querySelectorAll('.crm-action-change-choices button')[2].click()");
    await browser.wait("!document.querySelector('.crm-action-change-controls button').disabled");
    await browser.evaluate("[...document.querySelectorAll('.crm-action-change-controls button')].find(b=>b.textContent.includes('生成变更预览')).click()");
    await browser.wait("document.querySelector('.crm-action-change-controls button:nth-child(2)').disabled===false");
    assert.match(await browser.evaluate("document.querySelector('.crm-action-change-notice').innerText"),/变更计划已生成/);
    assert.deepEqual(await browser.evaluate("window.changeCalls.find(x=>x.p.stage==='plan').p.command.changes"),
      {title:'Review renewal',due_at:'2026-10-30T17:00:00+08:00',priority:'high'});
    assert.match(await browser.evaluate("document.querySelector('.crm-action-change-test-notice').innerText"),/勿联系|do not contact/);
    await browser.evaluate("document.querySelectorAll('.crm-action-change-controls button')[1].click()");
    await browser.wait("document.querySelector('.crm-action-change-preview').innerText.includes('变更前')");
    assert.match(await browser.evaluate("document.querySelector('.crm-action-change-notice').innerText"),/核验预览已显示在下方/);
    let state=await browser.evaluate(`({text:document.querySelector('.crm-action-change-preview').innerText,
      executeDisabled:document.querySelectorAll('.crm-action-change-controls button')[3].disabled,
      executeCalls:window.changeCalls.filter(x=>x.p.stage==='execute').length,
      selected:window.changeCalls.filter(x=>x.p.action==='actionCommandTargets').map(x=>x.p.selectedPersonId)})`);
    assert.match(state.text,/Review renewal/);assert.match(state.text,/高/);assert.equal(state.executeDisabled,true);assert.equal(state.executeCalls,0);assert.deepEqual(state.selected,['783']);
    await browser.evaluate("document.querySelectorAll('.crm-action-change-controls button')[2].click()");
    await browser.wait("document.querySelectorAll('.crm-action-change-controls button')[3].disabled===false");
    assert.equal(await browser.evaluate("window.changeCalls.filter(x=>x.p.stage==='execute').length"),0);
    await browser.evaluate("document.querySelectorAll('.crm-action-change-controls button')[3].click()");
    await browser.wait("document.querySelector('.crm-action-change-notice').innerText.includes('行动变更已完成')");
    assert.equal(await browser.evaluate("window.changeCalls.filter(x=>x.p.stage==='execute').length"),1);
    await browser.evaluate("window.renderActionChange('en')");
    await browser.wait("document.querySelector('.crm-action-change h2').innerText.includes('Update or complete')");
    const en=await browser.evaluate("document.querySelector('.crm-action-change').innerText");assert.match(en,/Change request/);assert.match(en,/Prepare change preview/);
    await browser.evaluate("window.closeMode=true;window.renderActionChange('en');document.querySelector('.crm-action-change textarea').value='Complete Fictional Alex review renewal';document.querySelector('.crm-action-change form').requestSubmit()");
    await browser.wait("document.querySelectorAll('.crm-action-change-choices button').length===2");
    await browser.evaluate("document.querySelectorAll('.crm-action-change-choices button')[0].click()");
    await browser.wait("document.querySelectorAll('.crm-action-change-choices button').length===3");
    await browser.evaluate("document.querySelectorAll('.crm-action-change-choices button')[2].click()");
    await browser.wait("document.querySelector('.crm-action-change-controls button').disabled===false");
    await browser.evaluate("document.querySelectorAll('.crm-action-change-controls button')[0].click()");
    await browser.wait("document.querySelector('.crm-action-change-controls button:nth-child(2)').disabled===false");
    assert.deepEqual(await browser.evaluate("window.changeCalls.filter(x=>x.p.stage==='plan').at(-1).p.command.changes"),{});
    await browser.evaluate("document.querySelectorAll('.crm-action-change-controls button')[1].click()");
    await browser.wait("document.querySelector('.crm-action-change-preview').innerText.includes('Completed')");
    assert.match(await browser.evaluate("document.querySelector('.crm-action-change-notice').innerText"),/verified preview is shown below/i);
    const closePreview=await browser.evaluate("document.querySelector('.crm-action-change-preview').innerText");
    assert.match(closePreview,/Completed at/);assert.match(closePreview,/Completed by/);assert.match(closePreview,/Confirmation expires/);
    assert.equal(await browser.evaluate("window.changeCalls.filter(x=>x.p.stage==='execute').length"),1);
    await browser.evaluate("document.querySelectorAll('.crm-action-change-controls button')[2].click()");
    await browser.wait("document.querySelectorAll('.crm-action-change-controls button')[3].disabled===false");
    assert.equal(await browser.evaluate("window.changeCalls.filter(x=>x.p.stage==='execute').length"),1);
    await browser.evaluate("document.querySelectorAll('.crm-action-change-controls button')[3].click()");
    await browser.wait("document.querySelector('.crm-action-change-notice').innerText.includes('The Action change is complete')");
    for(const [width,height] of [[1180,820],[820,1180]]) { await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false}); assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height}`); }
    await browser.send('Emulation.clearDeviceMetricsOverride');
  } finally { await browser.close(); }
});
