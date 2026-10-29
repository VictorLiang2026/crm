'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Browser } = require('../regression/browser.cjs');

async function setup(b, recordOnly = false, multipleItems = false) {
  await b.start(); await b.open('#/more');
  await b.evaluate(`(async()=>{
    await new Promise((resolve,reject)=>{
      const css=document.createElement('link');css.rel='stylesheet';css.href='/crm/css/console.css';
      css.onload=resolve;css.onerror=reject;document.head.appendChild(css);
    });
    const {openQuickCapture}=await import('/crm/js/modules/console/write.js');
    const {setLang}=await import('/crm/js/modules/console/i18n.js');setLang('zh-CN');
    window.focus={calls:[],done:0, async call(api,args){
      this.calls.push({api,args});
      if(api==='ai_parse')return {parsed:{focused:true,person_name:'虚构甲',
        interaction_type:'微信',summary:'交流摘要：约好发资料。',facts:['只周末联系'],
        memories:[{content:'只周末联系',evidence:'只周末联系'}],contextChecked:!!args.personId,
        suggestions:[{kind:'action',title:'发资料',date:null,method:'微信发送',reason:'应对方要求',
          existing:args.personId?{id:7,kind:'action',person_id:783,title:'原有发资料任务',status:'open'}:null}],
        commitments:${multipleItems ? JSON.stringify([{kind:'commitment',title:'确认保费预算',date:'2026-10-25',
          evidence:'我答应下周确认保费预算',commitmentType:'I_PROMISED'}]) : '[]'}}};
      if(args.action==='resolveQuickCaptureName')return {displayName:'虚构甲',status:'confirm_existing',
        candidates:[{id:783,displayName:'虚构甲'}]};
      if(args.action==='listPersonWorkItems')return {personId:783,rows:[
        {id:7,kind:'action',person_id:783,title:'原有发资料任务',status:'open'}]};
      if(args.action==='getContextGroups')return {groups:{fact:[]}};
      if(args.action==='previewIdentity')return {previewId:'217ecbb5-aa90-4d8b-92ec-6a3b82202901',
        preview:{...args.data,newPerson:false,personId:783}};
      if(args.action==='executeIdentity')return {personId:783,interactionId:9003};
      if(args.action==='previewWorkItem')return {previewId:'217ecbb5-aa90-4d8b-92ec-6a3b82202902',
        preview:{personName:'虚构甲',after:args.data.draft,before:{title:'原有发资料任务'}}};
      throw Error('Unexpected '+api+' '+args.action);
    }};
    openQuickCapture({api:{call:(...args)=>window.focus.call(...args)},toast:()=>{}},{onDone:()=>window.focus.done++});
    document.querySelector('.sheet-overlay textarea').value='虚构甲只周末联系，约好发资料';
    document.querySelector('.sheet-overlay .btn-primary').click();
  })()`);
  await b.wait("document.querySelector('.sheet-overlay .cand')");
  await b.evaluate("document.querySelector('.sheet-overlay .cand').click()");
  await b.wait("document.querySelector('.sheet-overlay')?.innerText.includes('已参考近期')");
  if (recordOnly) await b.evaluate("document.querySelector('[data-capture-record-only]').click()");
}
test('record-only preview has zero memories and signals, raw note intact, no task writes', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await setup(b, true);
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()");
    await b.wait("window.focus.calls.some(c=>c.args.action==='previewIdentity')");
    const command = await b.evaluate("window.focus.calls.find(c=>c.args.action==='previewIdentity').args.data");
    assert.deepEqual(command.facts, []); assert.deepEqual(command.signals, []);
    assert.equal(command.interaction.summary, '交流摘要：约好发资料。');
    assert.equal(command.interaction.rawNote, '虚构甲只周末联系，约好发资料');
    assert.equal(await b.evaluate("window.focus.calls.some(c=>c.args.action==='executeIdentity')"), false);
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()");
    await b.wait("window.focus.done===1");
    assert.equal(await b.evaluate("window.focus.calls.some(c=>c.args.action==='previewWorkItem')"), false);
    await b.healthy();
  } finally { await b.close(); }
});
test('focused capture consolidates suggestions and promises into one reviewed action plan', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await setup(b, false, true);
    const plan = await b.evaluate(`({count:document.querySelectorAll('[data-capture-action-plan]').length,
      text:document.querySelector('[data-capture-action-plan]')?.innerText||''})`);
    assert.equal(plan.count, 1);
    assert.match(plan.text, /发资料/);
    assert.match(plan.text, /确认保费预算/);
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()");
    await b.wait("window.focus.calls.some(c=>c.args.action==='previewIdentity')");
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()");
    await b.wait("document.querySelector('[data-capture-plan-action]')");
    assert.equal(await b.evaluate("document.querySelectorAll('[data-capture-plan-action]').length"), 1);
    await b.evaluate("document.querySelector('[data-capture-plan-action]').click()");
    await b.wait("document.querySelectorAll('.sheet-overlay').length===2");
    const description = await b.evaluate("[...document.querySelectorAll('.sheet-overlay')].at(-1).querySelector('textarea')?.value||''");
    assert.match(description, /发资料/);
    assert.match(description, /确认保费预算/);
    assert.equal(await b.evaluate("window.focus.calls.some(c=>c.args.action==='previewWorkItem')"), false);
    await b.healthy();
  } finally { await b.close(); }
});
test('history is read only after person selection; existing tasks open for separate edit preview', async () => {
  const b = new Browser(path.resolve(__dirname, '../..'));
  try {
    await setup(b);
    const parses = await b.evaluate("window.focus.calls.filter(c=>c.api==='ai_parse').map(c=>c.args)");
    assert.equal(parses[0].personId, undefined); assert.equal(parses[1].personId, '783');
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()");
    await b.wait("window.focus.calls.some(c=>c.args.action==='previewIdentity')");
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay .sheet-actions button')].at(-1).click()");
    await b.wait("document.querySelector('.sheet-overlay')?.innerText.includes('行动计划尚未写入待办')");
    assert.equal(await b.evaluate("window.focus.calls.some(c=>c.args.action==='previewWorkItem')"), false);
    await b.evaluate("document.querySelector('.sheet-overlay .btn-soft').click()");
    await b.wait("document.querySelectorAll('.sheet-overlay').length===2");
    assert.equal(await b.evaluate("[...document.querySelectorAll('.sheet-overlay')].at(-1).querySelector('input').value"), '原有发资料任务');
    await b.evaluate("[...document.querySelectorAll('.sheet-overlay')].at(-1).querySelector('.btn-primary').click()");
    await b.wait("window.focus.calls.some(c=>c.args.action==='previewWorkItem')");
    const cmd = await b.evaluate("window.focus.calls.find(c=>c.args.action==='previewWorkItem').args.data");
    assert.equal(cmd.operation, 'edit'); assert.equal(cmd.itemId, 7);
    assert.equal(await b.evaluate("window.focus.calls.some(c=>c.args.action==='executeWorkItem')"), false);
    for (const [width, height] of [[820, 1180], [1180, 820]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      assert.equal(await b.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
    }
    await b.healthy();
  } finally { await b.close(); }
});
