'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Browser}=require('../regression/browser.cjs');
for(const lang of ['zh-CN','en'])test(`L04a PDF imports preserve originals, localized failure history and human review (${lang})`,async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.open('#/more');
  await b.evaluate(`(async()=>{
   const {fileImportNode}=await import('/crm/js/modules/console/file-import.js');
   const {data}=await import('/crm/js/modules/console/data.js');
   (await import('/crm/js/modules/console/i18n.js')).setLang('${lang}');
   window.pdfCase={calls:[],jobs:[],code:'PDF_ENCRYPTED',reviews:0};
   data.fileImports=async()=>({rows:pdfCase.jobs.map(x=>({...x})),hasMore:false});
   data.saveFileOriginal=async(ctx,p)=>{pdfCase.calls.push('save');const job={id:p.idempotencyKey,file_name:p.fileName,content_type:p.contentType,status:'saved',sourceAvailable:true,created_at:'2026-10-25'};pdfCase.jobs.push(job);return {job:{...job}};};
   data.parseFileDraft=async(ctx,id)=>{pdfCase.calls.push('parse');const job=pdfCase.jobs.find(x=>x.id===id);Object.assign(job,{status:pdfCase.code?'failed':'draft',error_code:pdfCase.code,ocr_record_id:pdfCase.code?null:101});return {job:{...job}};};
   document.getElementById('view').replaceChildren(await fileImportNode({},1,2,{onReview:async()=>{pdfCase.reviews++;}}));
   const input=document.querySelector('.file-import input[type=file]');
   Object.defineProperty(input,'files',{configurable:true,value:[new File(['%PDF-fixture'],'fictional.pdf',{type:'application/pdf'})]});input.dispatchEvent(new Event('change'));
  })()`);
  const label=key=>lang==='en'?key[1]:key[0];
  await b.click('.file-import > .care-record-actions button',label(['保存全部原件','Save All Originals']));
  await b.wait("pdfCase.calls.length===1&&!document.querySelector('.file-import input[type=file]').disabled");
  assert.deepEqual(await b.evaluate('pdfCase.calls'),['save']);
  await b.click('.file-import > .care-record-actions button',label(['保存并解析支持的文件','Save All & Parse Supported Files']));
  await b.wait("document.querySelector('.file-import-history').textContent.includes('"+label(['PDF已加密','Encrypted PDFs'])+"')");
  await b.evaluate("document.querySelector('.file-import > details').open=true");
  for(const [code,phrase]of [['PDF_NO_TEXT',['至少有一页','At least one']],['PDF_LIMIT',['超出20页','exceeds 20 pages']],['PDF_TIMEOUT',['超过8秒','exceeded 8 seconds']]]){
   await b.evaluate(`pdfCase.code='${code}'`);
   await b.click('.file-import-history button',label(['解析／重试解析','Parse / Retry']));
   await b.wait("document.querySelector('.file-import-history').textContent.includes('"+label(phrase)+"')&&!document.querySelector('.file-import input[type=file]').disabled");
  }
  assert.equal(await b.evaluate("pdfCase.calls.filter(x=>x==='save').length"),1,'parse retries do not upload again');
  assert.equal(await b.evaluate('pdfCase.reviews'),0,'no automatic application');
  for(const [width,height]of [[820,1180],[1180,820]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  }
  const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync('tests/security/.results',{recursive:true});fs.writeFileSync(`tests/security/.results/l04a-${lang}.png`,Buffer.from(shot.data,'base64'));
  await b.evaluate('pdfCase.code=null');await b.click('.file-import-history button',label(['解析／重试解析','Parse / Retry']));
  await b.wait("document.querySelector('.file-import-history').textContent.includes('"+label(['审核已保存草稿','Review Saved Draft'])+"')");
  assert.equal(await b.evaluate('pdfCase.reviews'),0);
  await b.click('.file-import-history button',label(['审核已保存草稿','Review Saved Draft']));await b.wait('pdfCase.reviews===1');
  await b.evaluate(`(()=>{const input=document.querySelector('.file-import input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:[new File([new Uint8Array(4*1024*1024+1)],'large.pdf',{type:'application/pdf'})]});input.dispatchEvent(new Event('change'));})()`);
  assert.equal(await b.evaluate("document.querySelectorAll('.file-import-item').length"),1);
  assert.match(await b.evaluate("document.querySelector('.file-import > p[role=status]').textContent"),lang==='en'?/Files not added/:/未加入文件/);
  await b.healthy();
 }finally{await b.close();}
});
