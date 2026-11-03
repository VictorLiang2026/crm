'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');

test('iPad knowledge basic info and content confirmation are readable in both languages',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();
  await b.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false});
  await b.openConsole('#/more','authCase=1');
  await b.wait("document.querySelector('.console-main')");
  await b.evaluate(`(async()=>{
   const {renderKnowledgeEditor}=await import('/crm/js/modules/console/knowledge-pages.js');
   const {data}=await import('/crm/js/modules/console/data.js');
   const i18n=await import('/crm/js/modules/console/i18n.js');
   const source={id:'71',source:'Synthetic policy',source_id:'5',updated_at:'2026-11-01T00:00:00Z',confidence:0.9,
    metadata:{categories:['legal_tax'],publisher:'Regulator',source_uri:'https://example.invalid/policy',published_at:'2026-05-01',review_at:'2027-05-01'}};
   const record={id:'71',table:'knowledge_items',title:'Synthetic policy',updatedAt:source.updated_at,selected:'original',paused:false,
    original:{text:'System original line one\\nSystem original line two',summary:'System summary',reviewed:true},
    gpt:{summary:'GPT summary',reviewed:true}};
   data.knowledgeLibrary=async(_ctx,operation,options={})=>operation==='list'
    ?{knowledge:[source],sources:[{id:'5',publisher:'Regulator',source_uri:'https://example.invalid/policy',published_at:'2026-05-01',review_at:'2027-05-01'}]}
    :operation==='content'?{record,pending:null,history:[]}:(()=>{throw Error('unexpected operation '+operation)})();
   const ctx={main:document.querySelector('.console-main'),toast:()=>{}};
   window.kgBasic={ctx,source,render:()=>renderKnowledgeEditor(ctx,{mode:'edit',table:'knowledge_items',id:'71'}),i18n};
   window.kgBasic.render();
  })()`);
  await b.wait("document.querySelector('.kg-readonly-gpt_summary pre')?.textContent==='GPT summary'");
  assert.equal(await b.evaluate("document.querySelector('.page-title').textContent"),'基本信息');
  assert.deepEqual(await b.evaluate("[...document.querySelectorAll('.kg-readonly-field h3')].map(x=>x.textContent)"),['系统摘要','系统原文','GPT摘要']);
  assert.equal(await b.evaluate("[...document.querySelectorAll('.kg-basic-info-grid .kg-field > span')].map(x=>x.textContent).join('|')"),
   '发布机构|公开来源链接（如有）|发布日期|下次复核日期|置信度（0 至 1）');
  assert.equal(await b.evaluate("document.querySelector('.kg-basic-info-form [name=content]').type"),'hidden');
  assert.equal(await b.evaluate("document.querySelector('.kg-basic-info-form [name=summary]').type"),'hidden');
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('.kg-basic-info-grid')).gridTemplateColumns.split(' ').length"),2);
  const basicInfoShot=await b.send('Page.captureScreenshot',{format:'png'});
  const basicInfoEvidence=path.resolve(__dirname,'../regression/.results/basic-info-ipad.png');
  fs.mkdirSync(path.dirname(basicInfoEvidence),{recursive:true});
  fs.writeFileSync(basicInfoEvidence,Buffer.from(basicInfoShot.data,'base64'));
  await b.evaluate("document.querySelector('.kg-content-readonly .btn-primary').click()");
  await b.wait("document.querySelector('.kc-editor[data-content-target=original] textarea')");
  assert.equal(await b.evaluate("document.querySelector('.sheet-title').textContent"),'内容确认');
  assert.ok(await b.evaluate("document.querySelector('.kc-sheet-overlay .sheet').getBoundingClientRect().width")>=900);
  assert.ok(await b.evaluate("document.querySelector('.kc-editor[data-content-target=original] textarea').getBoundingClientRect().width")>400);
  await b.evaluate("document.querySelector('.sheet-head button').click();window.kgBasic.i18n.setLang('en');window.kgBasic.render()");
  await b.wait("document.querySelector('.page-title').textContent==='Basic information'");
  assert.equal(await b.evaluate("[...document.querySelectorAll('.kg-readonly-field h3')].map(x=>x.textContent).join('|')"),
   'System summary|System original|GPT summary');
  await b.evaluate("document.querySelector('.kg-content-readonly .btn-primary').click()");
  await b.wait("document.querySelector('.sheet-title').textContent==='Content confirmation'");
  assert.equal(await b.evaluate("document.querySelector('.kc-panel').innerText.includes('kc_')"),false);
  const shot=await b.send('Page.captureScreenshot',{format:'png'});
  const evidence=path.resolve(__dirname,'../regression/.results/basic-info-layout-ipad.png');
  fs.mkdirSync(path.dirname(evidence),{recursive:true});fs.writeFileSync(evidence,Buffer.from(shot.data,'base64'));
  await b.healthy();
 }finally{await b.close();}
});
