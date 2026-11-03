'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {effectiveContent,projectContent,managementRow}=require('../../cloudfunctions/_shared/knowledge-content');
const {createKnowledgeContentService}=require('../../cloudfunctions/assistant/knowledge-content-service');
const {KnowledgeGovernanceService}=require('../../cloudfunctions/person_360/knowledge-governance-service');
const {extractText}=require('../../cloudfunctions/assistant/knowledge-library-service');
const base={id:1,content:'System text',metadata:{summary:'System summary',secretUnselected:'not for prompt'},lifecycle_status:'verified'};
function managed(selected='original') {return {...base,gpt_summary:'GPT summary',selected_content_source:selected,
 content_state:{version:2,baseSignature:createHash('md5').update('System text\x1fSystem summary').digest('hex'),
 original:{text:'Edited system',summary:'Edited summary',reviewed:true},gpt:{reviewed:true}}};}
test('legacy content is compatible; selected pairs never mix and hidden content is excluded',()=>{
 assert.equal(effectiveContent(base).text,'System text');assert.equal(effectiveContent({...base,metadata:{}}).text,'System text');
 const row=projectContent(managed(),'knowledge_items');assert.equal(row.content,'Edited system');assert.equal(row.metadata.summary,'Edited summary');
 assert.equal(row.content_state,undefined);assert.equal(row.metadata.secretUnselected,undefined);
 assert.deepEqual(row.contentReference,{contentSource:'original',contentVersion:2});
 const missing=managed();missing.metadata={};missing.content_state.original.summary=null;assert.equal(effectiveContent(missing),null);
});
test('manual clears, unreviewed edits, stale sources and source invalidity pause selected use',()=>{
 const row=managed('original');row.content_state.original.text=null;assert.equal(effectiveContent(row),null);
 const unreviewed=managed();unreviewed.content_state.gpt.reviewed=false;assert.equal(effectiveContent(unreviewed).text,'Edited system');
 const attached=managed();attached.source_id=3;attached.content_state.sourceFingerprint='sha:1';
 assert.equal(effectiveContent(attached,'knowledge_items',{sha256:'sha',version_no:2,lifecycle_status:'verified'}),null);
 assert.equal(effectiveContent(attached,'knowledge_items',{sha256:'sha',version_no:1,lifecycle_status:'invalidated'}),null);
 assert.equal(effectiveContent(attached),null);
});
test('management previews stay bounded and do not disguise cleared system text with fallback',()=>{
 const row=managed();row.content_state.original.text=null;
 const display=managementRow(row,'knowledge_items');assert.equal(display.content,null);assert.equal(display.gpt_summary_preview,'GPT summary');
 assert.equal(display.gpt_original_preview,undefined);assert.equal(display.content_state,undefined);
});
test('playbook response text is not a saved system summary; Person resolver retains its scoped legacy review fallback',()=>{
 const {contentVersions}=require('../../cloudfunctions/_shared/knowledge-content');
 assert.equal(contentVersions({response_logic:'Old response'},'playbooks').original.summary,null);
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../../cloudfunctions');
 const shared=fs.readFileSync(path.join(root,'_shared/knowledge-content.js'),'utf8');
 assert.equal(fs.readFileSync(path.join(root,'assistant','knowledge-content.js'),'utf8'),shared);
 const person=fs.readFileSync(path.join(root,'person_360','knowledge-content.js'),'utf8');
 assert.match(person,/const reviewAt=Object\.hasOwn\(row\.metadata\|\|\{},'review_at'\)/,'Person resolver retains row-metadata fallback');
 assert.match(shared,/source\.review_at && source\.review_at < today/,'shared resolvers use the linked source review date');
});
test('worker checkpoints extraction and summary separately; final content is saved directly',async()=>{
 const record={updatedAt:'2026-10-30',title:'Fixture',source:{id:3},version:2,sourceFingerprint:'sha:1'},calls=[];
 const job={id:'job',actor_uid:'actor',record_table:'knowledge_items',record_id:1,expected_updated_at:record.updatedAt,
 before_state:record,lease_token:'lease',payload:{stage:'extract',part:'both',nextPage:1}};
 const service=createKnowledgeContentService({rpc:async(name,args)=>{calls.push(args);
  if(args.p_operation==='claim')return {data:{ok:true,job}};
  if(args.p_operation==='get')return {data:{ok:true,record}};
  if(args.p_operation==='progress'){job.payload=args.p_data.payload;return {data:{ok:true}};}
  if(args.p_operation==='save')return {data:{ok:true,record}};
  throw Error('Unexpected operation');},request:async()=>[{file_name:'file.txt',content_type:'text/plain',lifecycle_status:'verified'}],
  sourceBytes:async()=>Buffer.from('source'),extractText:async()=> 'Extracted',generateSummary:async()=>({summary:'Summary',taskId:'t',resultId:'r'})});
 await service.worker();assert.equal(job.payload.stage,'summary');assert.equal(job.payload.text,'Extracted');
 await service.worker();assert.equal(job.payload.stage,'save');assert.equal(job.payload.summary,'Summary');
 await service.worker();assert.equal(calls.find(c=>c.p_operation==='save').p_data.target,'original');
 assert.deepEqual(calls.find(c=>c.p_operation==='save').p_data.patch,{text:'Extracted',summary:'Summary'});
 assert.equal(calls.some(c=>['preview','apply','approve'].includes(c.p_operation)),false);
 await assert.rejects(()=>service.run('claim','actor',{}),e=>e.code==='INVALID_INPUT');
 await assert.rejects(()=>service.run('get','',{}),e=>e.code==='UNAUTHORIZED');
});
test('failed summary preserves extracted text for explicit retry; stale jobs never generate',async()=>{
 const record={updatedAt:'same'},job={id:'job',actor_uid:'actor',record_table:'knowledge_items',record_id:1,before_state:record,payload:{stage:'summary',part:'both',text:'Preserve me'}};
 let saved,generated=0;
 const service=createKnowledgeContentService({rpc:async(name,args)=>({data:args.p_operation==='claim'?{ok:true,job}:args.p_operation==='get'?{ok:true,record}:(saved=args.p_data,{ok:true})}),
 generateSummary:async()=>{generated++;throw Object.assign(Error(),{code:'TIMEOUT'});}});
 await service.worker();assert.equal(saved.status,'failed');assert.equal(saved.payload.text,'Preserve me');assert.equal(generated,1);
 job.before_state={updatedAt:'old'};await service.worker();assert.equal(saved.errorCode,'CONTENT_STALE');assert.equal(generated,1);
});
test('managed playbooks retain legacy metadata editing without overwriting either pair',async()=>{
 const current={...managed(),response_logic:'System text',scenario:'Original title',next_objective:'Confirm',confidence:0.9,updated_at:'stamp'};
 let patched;
 const service=new KnowledgeGovernanceService({request:async(table,method,filters,payload)=>{
  if(method==='GET')return [current];patched=payload;return [{...current,...payload}];},rpc:async()=>{throw Error('Unexpected RPC');}});
 await service.save({id:1,table:'playbooks',scenario:'Renamed',response_logic:'Edited system',next_objective:'Confirm',confidence:0.9,
  categories:['conversation_strategy'],expectedUpdatedAt:'stamp'},'actor');
 assert.equal(patched.scenario,'Renamed');assert.equal(patched.response_logic,'System text');
 assert.equal(patched.content_state,undefined);assert.equal(patched.gpt_original_text,undefined);
 await assert.rejects(()=>service.save({id:1,table:'playbooks',scenario:'Renamed',response_logic:'Attempt overwrite',next_objective:'Confirm',confidence:0.9,
  categories:['conversation_strategy'],expectedUpdatedAt:'stamp'},'actor'),/CONTENT_USE_VERSION_EDITOR/);
});
test('PDF OCR regeneration resumes three-page batches then directly saves generated content',async()=>{
 const record={updatedAt:'stamp',source:{id:3},version:1,sourceFingerprint:'sha:1'},job={id:'job',actor_uid:'actor',record_table:'knowledge_items',record_id:1,before_state:record,
  payload:{stage:'extract',part:'both',nextPage:1,pdfOcr:true}};
 const starts=[];let generated=0;
 const service=createKnowledgeContentService({rpc:async(name,args)=>({data:args.p_operation==='claim'?{ok:true,job}:args.p_operation==='get'?{ok:true,record}:
  (job.payload=args.p_data.payload,{ok:true})}),request:async()=>[{file_name:'scan.pdf',content_type:'application/pdf',lifecycle_status:'verified'}],
  sourceBytes:async()=>Buffer.from('pdf'),renderPdfPages:async(bytes,options)=>{starts.push(options.startPage);assert.equal(options.maxPages,3);
   await options.onBatch([{base64:'fixture'}]);return {pageCount:5,nextPage:options.startPage+3};},
  callFunction:async()=>({result:{ocrText:'Batch text'}}),generateSummary:async()=>{generated++;return {summary:'Summary'};}});
 await service.worker();assert.equal(job.payload.stage,'extract');assert.equal(job.payload.nextPage,4);
 await service.worker();assert.equal(job.payload.stage,'summary');assert.equal(generated,0);assert.deepEqual(starts,[1,4]);
 await service.worker();assert.equal(generated,1);assert.equal(job.payload.stage,'save');
 await service.worker();assert.equal(job.payload.saved,true);
});
test('large image regeneration reuses private source capability and then saves extracted text',async()=>{
 const record={updatedAt:'stamp',source:{id:3},version:1,sourceFingerprint:'sha:1'},job={id:'job',actor_uid:'actor',record_table:'knowledge_items',record_id:1,before_state:record,
  payload:{stage:'extract',part:'both',nextPage:1}};
 const image=Buffer.alloc(7*1024*1024);Buffer.from([137,80,78,71,13,10,26,10]).copy(image);let ocrRequest;
 const service=createKnowledgeContentService({rpc:async(name,args)=>({data:args.p_operation==='claim'?{ok:true,job}:args.p_operation==='get'?{ok:true,record}:
  (job.payload=args.p_data.payload,{ok:true})}),request:async()=>[{id:3,file_name:'large.png',content_type:'image/png',lifecycle_status:'verified',metadata:{upload:{upload_id:'private-capability'}}}],
  sourceBytes:async()=>image,extractText,callFunction:async request=>{ocrRequest=request;return {result:{ocrText:'Recognized content'}};}});
 await service.worker();assert.deepEqual(ocrRequest,{name:'ai_parse',data:{action:'ocr_knowledge_source',sourceId:'3',uploadId:'private-capability'}});
 assert.equal(job.payload.text,'Recognized content');assert.equal(job.payload.stage,'summary');
});
