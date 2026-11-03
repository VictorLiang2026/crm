'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');

test('iPad content confirmation directly saves GPT and system fields without review or progress controls',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.send('Emulation.setDeviceMetricsOverride',{width:1366,height:1024,deviceScaleFactor:1,mobile:false});
  await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.console-main')");
  await b.evaluate(`(async()=>{
   const {openKnowledgeContent}=await import('/crm/js/modules/console/knowledge-content.js');
   const {data}=await import('/crm/js/modules/console/data.js');window.kcI18n=await import('/crm/js/modules/console/i18n.js');
   window.kcCalls=[];window.kcRecord={id:1,table:'knowledge_items',title:'Synthetic fixture',updatedAt:'2026-10-30T00:00:00Z',
    sourceFingerprint:null,version:2,original:{text:'System text',summary:'System summary'},gpt:{summary:null,reviewed:false},selected:'original'};
   data.knowledgeLibrary=async(_ctx,_operation,options)=>{
    const op=options.contentOperation,d=options.data;window.kcCalls.push({contentOperation:op,data:d});
    if(op==='get')return {ok:true,record:structuredClone(window.kcRecord)};
    if(op==='save'){
     if(d.target==='gpt')Object.assign(window.kcRecord.gpt,d.patch);
     else Object.assign(window.kcRecord.original,d.patch);
     window.kcRecord.version++;window.kcRecord.updatedAt='2026-10-30T00:00:0'+window.kcRecord.version+'Z';
     return {ok:true,record:structuredClone(window.kcRecord)};
    }
    if(op==='regenerate')return {ok:true,status:'queued'};
    throw Error('Unexpected operation '+op);
   };
   const ctx={toast:()=>{}};window.kcOpen=()=>openKnowledgeContent(ctx,{id:1,table:'knowledge_items'});await window.kcOpen();
  })()`);
  await b.wait("document.querySelector('.kc-field-card.kc-original textarea')");
  assert.equal(await b.evaluate("document.querySelectorAll('.kc-field-card').length"),3);
  assert.equal(await b.evaluate("document.querySelector('.kc-sheet-overlay .sheet').getBoundingClientRect().width"),1128);
  assert.equal(await b.evaluate("document.querySelector('.kc-panel').innerText.includes('预览并送审')||document.querySelector('.kc-panel').innerText.includes('待审核')"),false);
  assert.equal(await b.evaluate("/刷新进度|重新预览|候选内容/.test(document.querySelector('.kc-panel').innerText)"),false);
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.kc-edit-grid')).gridTemplateColumns.split(' ').length"),2);
  await b.evaluate(`(()=>{const card=document.querySelector('.kc-gpt-summary textarea');card.value='<img src=x onerror="window.kcXss=1"> summary';
   [...document.querySelectorAll('.kc-gpt-summary button')].find(x=>x.textContent==='保存').click();})()`);
  await b.wait("window.kcRecord.gpt.summary?.includes('<img')");
  assert.deepEqual(await b.evaluate("window.kcCalls.filter(x=>x.contentOperation==='save').at(-1).data"),{
   table:'knowledge_items',id:1,expectedUpdatedAt:'2026-10-30T00:00:00Z',expectedVersion:2,expectedSourceFingerprint:null,
   target:'gpt',patch:{summary:'<img src=x onerror="window.kcXss=1"> summary'}});
  assert.equal(await b.evaluate("window.kcRecord.original.text==='System text'&&window.kcRecord.original.summary==='System summary'&&!window.kcXss"),true);
  await b.evaluate(`(()=>{const original=document.querySelector('.kc-original textarea');original.value='Edited original';
   document.querySelector('.kc-system-summary textarea').value='Edited system summary';
   [...document.querySelectorAll('.kc-original button')].find(x=>x.textContent==='保存').click();})()`);
  await b.wait("window.kcRecord.original.text==='Edited original'");
  assert.deepEqual(await b.evaluate("window.kcCalls.filter(x=>x.contentOperation==='save').at(-1).data.patch"),
   {text:'Edited original',summary:'Edited system summary'});
  assert.equal(await b.evaluate("window.kcCalls.some(x=>['preview','apply','approve','reject','command','retry'].includes(x.contentOperation))"),false);
  await b.evaluate("document.querySelector('.sheet-head button').click();window.kcI18n.setLang('en');window.kcOpen()");
  await b.wait("document.querySelector('.kc-panel')?.innerText.includes('GPT summary')");
  assert.equal(await b.evaluate("document.querySelector('.kc-panel').innerText.includes('kc_')"),false,await b.evaluate("document.querySelector('.kc-panel').innerText"));
  assert.equal(await b.evaluate("document.querySelector('.kc-panel').innerText.includes('Save')"),true);
  await b.healthy();
 }finally{await b.close();}
});
