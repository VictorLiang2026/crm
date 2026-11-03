'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');

test('iPad knowledge governance displays stored system text and GPT summary only',async()=>{
  const b=new Browser(path.resolve(__dirname,'../..'));
  const row=id=>`.kg-table tr[data-kg-id="${id}"]`;
  const button=(id,pair,part)=>`${row(id)} [data-kg-pair="${pair}"] [data-kg-part="${part}"]`;
  const body=(id,pair,part)=>`#kg-content-knowledge_items-${id}-${pair}-${part}`;
  const click=selector=>b.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const text=selector=>b.evaluate(`document.querySelector(${JSON.stringify(selector)}).innerText`);
  try{
    await b.start();await b.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
    await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.console-main')");
    await b.evaluate(`(async()=>{
      const {renderKnowledgeGovernance}=await import('/crm/js/modules/console/knowledge-governance.js');
      const i18n=await import('/crm/js/modules/console/i18n.js');
      const state={calls:[],revision:1,toasts:[]};window.kd=state;
      const ctx={main:document.querySelector('.console-main'),toast:(...x)=>state.toasts.push(x),api:{call:async(name,p)=>{
        state.calls.push(p);
        if(p.operation==='list')return {ok:true,knowledge:[
          {id:1,source:'Policy comparison',content:'System original',metadata:{summary:'System summary'},lifecycle_status:'verified',updated_at:'2026-10-30T00:00:0'+state.revision+'Z',contentVersion:state.revision,gpt_summary_preview:'GPT summary preview'},
          {id:2,source:'No GPT summary',content:'System original only',metadata:{summary:null},lifecycle_status:'draft',gpt_summary_preview:''}
        ],playbooks:[],sources:[]};
        if(p.operation==='setValidity'){state.revision++;return {ok:true};}
        if(p.operation==='content'&&p.contentOperation==='get')return {ok:true,record:{table:p.data.table,id:p.data.id,version:state.revision,
          original:{text:'System original',summary:'System summary'},gpt:{summary:('<img src=x onerror="window.kdXss=1"> GPT summary '+state.revision),reviewed:false}}};
        throw new Error('Unexpected operation');
      }}};
      state.render=()=>renderKnowledgeGovernance(ctx);state.i18n=i18n;state.render();
    })()`);
    await b.wait("document.querySelector('.kg-table [data-kg-pair]')");
    assert.equal(await text(`${row(1)} .kg-action-edit`),'基本信息','knowledge edit action uses the localized basic-info label');
    await b.evaluate("window.kd.i18n.setLang('en');window.kd.render()");
    await b.wait("document.querySelector('.kg-action-edit').innerText==='Basic information'");
    assert.equal(await text(`${row(1)} .kg-action-edit`),'Basic information','English label is localized too');
    await b.evaluate("window.kd.i18n.setLang('zh-CN');window.kd.render()");
    assert.equal(await b.evaluate("document.querySelectorAll('.kg-content-toggle[data-kg-pair=\\\"gpt\\\"][data-kg-part=\\\"text\\\"]').length"),0,'no GPT-original control remains');
    assert.equal(await b.evaluate("window.kd.calls.filter(x=>x.contentOperation==='get').length"),0,'list stays compact');
    await click(button(1,'gpt','summary'));
    await b.wait("document.querySelector('#kg-content-knowledge_items-1-gpt-summary').innerText.includes('GPT summary 1')");
    assert.match(await text(body(1,'gpt','summary')),/GPT summary 1/);
    assert.equal(await b.evaluate("!!window.kdXss||!!document.querySelector('.kg-content-body img')"),false,'stored summaries are rendered as text');
    assert.equal(await b.evaluate("window.kd.calls.filter(x=>x.contentOperation==='get').length"),1);
    await click(`${row(1)} .kg-action-status`);
    await b.wait("window.kd.revision===2 && document.querySelector('#kg-content-knowledge_items-1-gpt-summary').hidden");
    await click(button(1,'gpt','summary'));
    await b.wait("document.querySelector('#kg-content-knowledge_items-1-gpt-summary').innerText.includes('GPT summary 2')");
    assert.equal(await b.evaluate("window.kd.calls.filter(x=>x.contentOperation==='get').length"),2,'new content version is fetched again');
    assert.equal(await b.evaluate("window.kd.calls.filter(x=>x.operation==='content').every(x=>x.contentOperation==='get')"),true,'reading does not write');
    const shot=await b.send('Page.captureScreenshot',{format:'png'});
    const evidence=path.resolve(__dirname,'../regression/.results/knowledge-summary-only-ipad.png');
    fs.mkdirSync(path.dirname(evidence),{recursive:true});fs.writeFileSync(evidence,Buffer.from(shot.data,'base64'));
    await b.healthy();
  }finally{await b.close();}
});
