'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
test('iPad bilingual manual GPT editor requires server preview and explicit confirmation; hostile text remains text',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
  await b.openConsole('#/more','authCase=1');await b.wait("document.querySelector('.console-main')");
  await b.evaluate(`(async()=>{
   const {openKnowledgeContent}=await import('/crm/js/modules/console/knowledge-content.js');
   window.kcI18n=await import('/crm/js/modules/console/i18n.js');
   window.kcCalls=[];window.kcPending=null;window.kcRecord={id:1,table:'knowledge_items',title:'Synthetic fixture',updatedAt:'2026-10-30T00:00:00Z',
    original:{text:'System text',summary:'System summary',reviewed:true},gpt:{summary:null,reviewed:false},selected:'original',version:0};
   const ctx={toast:()=>{},api:{call:async(name,event)=>{
    window.kcCalls.push(event);const d=event.data;
    if(event.contentOperation==='get')return {ok:true,record:window.kcRecord,history:[{id:9,applied_at:'2026-10-29T00:00:00Z'}],pending:window.kcPending};
    if(event.contentOperation==='preview'){const after=structuredClone(window.kcRecord);Object.assign(after[d.target],d.patch,{reviewed:d.reviewed});
     window.kcAfter=after;return {ok:true,commandId:'server-preview',before:window.kcRecord,after};}
    if(event.contentOperation==='apply'){window.kcPending={commandId:'pending-command',after:window.kcAfter,createdAt:'2026-10-30T00:00:00Z'};return {status:'pending_review'};}
    if(event.contentOperation==='approve'){window.kcRecord=window.kcPending.after;window.kcPending=null;return {ok:true};}
    if(event.contentOperation==='reject'){window.kcPending=null;return {ok:true};}
    throw Error('unexpected call');}}};
   window.kcOpen=()=>openKnowledgeContent(ctx,{id:1,table:'knowledge_items'});await window.kcOpen();
  })()`);
  assert.equal(await b.evaluate("document.querySelectorAll('.kc-editor').length"),2,await b.evaluate("document.body.innerText.slice(-1800)"));
  assert.equal(await b.evaluate("document.querySelector('.kc-sheet-overlay')!==null"),true,'the live overlay receives its knowledge-specific class');
  assert.equal(await b.evaluate("!document.querySelector('.kc-panel').innerText.includes('变更历史')"),true,'the live editor omits history restore controls');
  assert.equal(await b.evaluate("![...document.querySelectorAll('.kc-editor button')].some(x=>x.textContent.includes('重新生成系统原文和摘要'))"),true,'the live editor exposes separate bounded regeneration actions');
  assert.equal(await b.evaluate("document.querySelector('[data-content-target=\\\"gpt\\\"] textarea').getAttribute('aria-label').endsWith('摘要')"),true);
  await b.evaluate(`(()=>{const panel=document.querySelector('[data-content-target="gpt"]');panel.querySelector('textarea').value='<img src=x onerror="window.kcXss=1">';
   panel.querySelector('input').checked=true;panel.querySelector('button').click();})()`);
  await b.wait("document.querySelector('.kc-preview')");
  assert.equal(await b.evaluate("window.kcCalls.some(e=>e.contentOperation==='apply')"),false);
  assert.equal(await b.evaluate("document.querySelector('.kc-preview img')===null && !window.kcXss"),true);
  await b.click('.kc-preview button','确认执行');
  await b.wait("document.querySelector('.kc-pending')");
  assert.deepEqual(await b.evaluate("window.kcCalls.filter(e=>e.contentOperation==='apply').map(e=>e.data)"),[{commandId:'server-preview'}]);
  assert.equal(await b.evaluate("!Object.hasOwn(window.kcRecord.gpt,'text') && !Object.hasOwn(window.kcPending.after.gpt,'text') && window.kcPending.after.gpt.summary.includes('<img')"),true);
  await b.click('.kc-pending button','审核通过并生效');
  await b.wait("document.querySelectorAll('.kc-editor').length===2");
  assert.equal(await b.evaluate("window.kcCalls.some(e=>e.contentOperation==='approve')"),true);
  await b.evaluate("document.querySelectorAll('[data-content-target=\"gpt\"] button')[2].click()");
  await b.wait("document.querySelector('.kc-preview')");
  assert.deepEqual(await b.evaluate("window.kcCalls.at(-1).data"),{table:'knowledge_items',id:1,expectedUpdatedAt:'2026-10-30T00:00:00Z',
    action:'edit',target:'original',patch:{summary:'<img src=x onerror=\"window.kcXss=1\">'},reviewed:true});
  await b.click('.kc-preview button','取消');
  await b.click('[data-content-target="gpt"] button','清空摘要');
  await b.wait("document.querySelector('.kc-preview')");
  assert.equal(await b.evaluate("window.kcCalls.at(-1).data.patch.summary"),null);
  await b.click('.kc-preview button','取消');
  await b.evaluate("document.querySelector('.sheet-head button').click();window.kcI18n.setLang('en');window.kcOpen()");
  await b.wait("document.querySelector('.kc-panel')?.innerText.includes('GPT summary')");
  assert.equal(await b.evaluate("document.querySelector('.kc-panel').innerText.includes('kc_')"),false);
  const image=await b.send('Page.captureScreenshot',{format:'png'});
  const evidenceDir=path.join(__dirname,'../regression/.results');
  fs.mkdirSync(evidenceDir,{recursive:true});fs.writeFileSync(path.join(evidenceDir,'knowledge-content-ipad-en.png'),Buffer.from(image.data,'base64'));
  await b.healthy();
 }finally{await b.close();}
});
