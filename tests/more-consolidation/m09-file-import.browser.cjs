'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {Browser}=require('../regression/browser.cjs');
test('M09 save-only, uncertain response retry, parse retry, stored review, pagination and bilingual iPad',async()=>{
 const b=new Browser(path.resolve(__dirname,'../..'));
 try{
  await b.start();await b.open('#/more');
  await b.evaluate(`(async()=>{
   const {renderOcrReview}=await import('/crm/js/modules/console/ocr-review.js');
   const {data}=await import('/crm/js/modules/console/data.js');
   window.m09={calls:[],jobs:[],records:[],saveFail:true,parseFail:true,pageFail:false};
   data.customerProfile=async()=>({status:'linked',customerId:71,person:{display_name:'虚构甲'},fields:{customer_name:'虚构甲',occupation:'旧职业'}});
   data.ocrRecords=async()=>({rows:window.m09.records});data.ocrParseCommands=async()=>[];
   data.fileImports=async(ctx,id,page)=>{m09.calls.push({action:'list',id,page});if(m09.pageFail)throw Error('network');
     return {rows:page===1?m09.jobs:[],hasMore:page===1&&m09.more===true};};
   data.saveFileOriginal=async(ctx,payload)=>{m09.calls.push({action:'save',payload});
     let job=m09.jobs.find(x=>x.idempotency_key===payload.idempotencyKey);
     if(!job){job={id:payload.idempotencyKey,idempotency_key:payload.idempotencyKey,person_id:12,customer_id:71,
       photo_id:100+m09.jobs.length,file_name:payload.fileName,content_type:payload.contentType,status:'saved',sourceAvailable:true,created_at:'2026-10-24'};m09.jobs.push(job);}
     if(m09.saveFail){m09.saveFail=false;throw Error('lost response after commit');}return {job:{...job}};};
   data.parseFileDraft=async(ctx,id)=>{m09.calls.push({action:'parse',id});const job=m09.jobs.find(x=>x.id===id);
     if(job.status==='draft')return {job:{...job}};
     if(m09.parseFail){m09.parseFail=false;job.status='failed';job.error_code='PARSE_FAILED';return {job:{...job}};}
     job.status='draft';job.error_code=null;job.ocr_record_id=201;job.parsed_fields={customer_name:'虚构甲',occupation:'新职业'};
     m09.records=[{id:201,customer_id:71,summary:'note.txt',raw_text:'姓名虚构甲，职业新职业',file_ids:'[100]',file_names:'["note.txt"]'}];return {job:{...job}};};
   data.resolvePersonName=async()=>({candidates:[{id:12,displayName:'虚构甲'}]});
   data.previewOcrParse=async()=>{m09.calls.push({action:'preview'});return {previewId:'00000000-0000-4000-8000-000000000201',preview:{before:{occupation:'旧职业'},after:{occupation:'新职业'}}};};
   data.executeOcrParse=async()=>{m09.calls.push({action:'execute'});return {commandId:'receipt'};};
   window.m09Render=async()=>document.getElementById('view').replaceChildren(await renderOcrReview({toast:()=>{},onWriteDone:()=>{}},12));
   await m09Render();
  })()`);
  await b.evaluate(`(()=>{const input=document.querySelector('.file-import input[type=file]');
   Object.defineProperty(input,'files',{configurable:true,value:[new File(['姓名虚构甲'],'note.txt',{type:'text/plain'}),new File(['pdf'],'manual.pdf',{type:'application/pdf'})]});input.dispatchEvent(new Event('change'));})()`);
  assert.equal(await b.evaluate("document.querySelectorAll('.file-import-item').length"),2);
  await b.click('.file-import > .care-record-actions button','保存全部原件');
  await b.wait("document.querySelector('.file-import-item').textContent.includes('尚未确认保存成功')");
  assert.equal(await b.evaluate("m09.calls.filter(x=>x.action==='parse').length"),0,'save only never parses');
  await b.click('.file-import-item:first-child button','保存原件');
  await b.wait("document.querySelector('.file-import-item').textContent.includes('原件已保存，尚未解析')");
  assert.equal(await b.evaluate('m09.jobs.length'),2,'uncertain response retry does not duplicate');
  const keys=await b.evaluate("m09.calls.filter(x=>x.action==='save'&&x.payload.fileName==='note.txt').map(x=>x.payload.idempotencyKey)");
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  await b.click('.file-import > .care-record-actions button','保存并解析支持的文件');
  await b.wait("document.querySelector('.file-import-item').textContent.includes('解析暂未完成')");
  assert.equal(await b.evaluate("m09.calls.filter(x=>x.action==='parse').length"),1,'PDF not sent for parsing');
  await b.click('.file-import-item:first-child button','保存并解析');
  await b.wait("document.querySelector('.file-import-item').textContent.includes('草稿已保存')");
  assert.equal(await b.evaluate("m09.calls.filter(x=>x.action==='save').length"),3,'parse retry does not upload again');
  assert.equal(await b.evaluate("m09.calls.some(x=>x.action==='execute')"),false);
  await b.click('.file-import-item:first-child button','审核已保存草稿');
  await b.wait("document.querySelector('.file-import-review .ocr-candidate-panel')");
  assert.match(await b.evaluate("document.querySelector('.file-import-review').textContent"),/旧职业/);
  await b.click('.file-import-review .ocr-identity-block button','查找匹配人物');
  await b.wait("document.querySelector('.file-import-review .ocr-candidate-person')");
  await b.evaluate("document.querySelector('.file-import-review .ocr-candidate-person input').click();document.querySelector('.file-import-review .ocr-identity-block input[type=checkbox]').click();document.querySelector('.file-import-review .ocr-field-row input[type=checkbox]').click()");
  await b.click('.file-import-review .ocr-candidate-panel button','生成服务端预览');
  await b.wait("document.querySelector('.file-import-review .ocr-preview-panel')");
  assert.equal(await b.evaluate("m09.calls.filter(x=>x.action==='execute').length"),0);
  await b.evaluate("document.querySelector('.file-import-review .ocr-preview-panel input[type=checkbox]').click()");
  await b.evaluate("document.querySelector('.file-import-review .ocr-preview-panel button.btn-primary').click()");
  await b.wait("m09.calls.some(x=>x.action==='execute')");
  await b.evaluate("m09.more=true;document.querySelector('.file-import > details').open=true");
  await b.click('.file-import > details button','刷新导入状态');
  await b.wait("[...document.querySelectorAll('.file-import > details button')].some(x=>x.textContent==='下一页'&&!x.disabled)");
  await b.click('.file-import > details button','下一页');await b.wait("document.querySelector('.file-import > details').textContent.includes('暂无导入记录')");
  await b.click('.file-import > details button','上一页');await b.wait("document.querySelectorAll('.file-import-history article').length===2");
  await b.evaluate('m09.pageFail=true');await b.click('.file-import > details button','刷新导入状态');
  await b.wait("document.querySelector('.file-import > details').textContent.includes('加载失败')");
  assert.equal(await b.evaluate("document.querySelectorAll('.file-import-history article').length"),2);
  await b.evaluate('m09.pageFail=false');
  for(const lang of ['zh-CN','en']){
   await b.evaluate(`(async()=>{(await import('/crm/js/modules/console/i18n.js')).setLang('${lang}');await m09Render()})()`);
   assert.match(await b.evaluate("document.querySelector('.file-import').textContent"),lang==='en'?/Import Documents/:/导入资料/);
   for(const [width,height]of [[820,1180],[1180,820]]){await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,lang+' '+width);}
  }
  await b.healthy();
 }finally{await b.close();}
});
