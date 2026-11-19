'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReferenceOptimization}=require('../../cloudfunctions/assistant/reference-optimization-service');
const {createParseStep}=require('../../cloudfunctions/assistant/reference-manual-parser');
const registry=require('../../cloudfunctions/assistant/reference-optimization-skills');
const uuid='11111111-1111-1111-1111-111111111111';

test('row selector validates scoped inputs, rejects MCP writes and exposes only safe conflict errors',async()=>{
 const calls=[];let error;
 const svc=createReferenceOptimization({rpc:async(_,{p_operation,p_data})=>{calls.push({p_operation,p_data});return error?{error:{message:error}}:{data:{ok:true}};}});
 const input={id:7,mode:'gpt',versionId:12,expectedCurrentId:9,expectedUpdatedAt:'2026-11-19T01:00:00Z'};
 await svc.run('selectMode',input,'staff');assert.equal(calls.length,1);
 for(const bad of [{...input,mode:'auto'},{...input,versionId:null},{...input,expectedUpdatedAt:'never'},{...input,confirmed:true}])await assert.rejects(svc.run('selectMode',bad,'staff'),/INVALID_INPUT/);
 await assert.rejects(svc.run('selectMode',input,'staff',{mcp:true}),/INVALID_OPERATION/);
 await assert.rejects(svc.run('select',{versionId:12,selectionMode:'gpt'},'staff'),/INVALID_INPUT/);
 assert.equal(calls.length,1);error='REFERENCE_STALE';await assert.rejects(svc.run('selectMode',input,'staff'),/REFERENCE_STALE/);
 error='REFERENCE_SELECTION_CHANGED';await assert.rejects(svc.run('selectMode',input,'staff'),/REFERENCE_SELECTION_CHANGED/);
 error='unexpected internal database detail';await assert.rejects(svc.run('selectMode',input,'staff'),/REFERENCE_STORAGE_FAILED/);
});
test('reference worker sends full version basis to configured Gateway and persists only a candidate',async()=>{
 const input={basis:{title:'Budget',content:'Respect refusal.'},original:{content:'Original nuance.'},edits:[{content:'Human nuance.'}],preferences:'Be concise.',instruction:'Use a question.'};
 const calls=[],svc=createReferenceOptimization({rpc:async(_,{p_operation,p_data})=>{
  calls.push([p_operation,p_data]);return {data:p_operation==='claim'?{ok:true,job:{id:uuid,lane:'system',actor_uid:'staff',lease:uuid,input}}:{ok:true}};
 },gateway:(actor,skills)=>{assert.equal(actor,'staff');assert.equal(skills,registry);return {runAITask:async request=>{
  assert.deepEqual(request.context.reference,input);registry.validateContext(request.skill,request.context);registry.validateInput(request.skill,request.input);
  return {taskId:5,result:{title:'Budget',content:'Would you like to pause?',note:'Respectful question.'}};
 }}}});
 assert.equal((await svc.work()).processed,true);assert.deepEqual(calls.map(c=>c[0]),['claim','finish']);
 assert.equal(calls[1][1].modelInfo.taskId,'5');
 await assert.rejects(svc.run('finish',{},'staff'),/INVALID_OPERATION/);
 await assert.rejects(svc.run('gptSave',{},'staff'),/INVALID_OPERATION/);
 await assert.rejects(svc.run('select',{},'staff',{mcp:true}),/INVALID_OPERATION/);
});
test('parse worker accounts for all paragraphs, persists OCR progress and never substitutes model prose for original text',async()=>{
 const xml='<w:p><w:r><w:t>1. Budget</w:t></w:r></w:p><w:p><w:r><w:t>Respect refusal.</w:t></w:r></w:p><w:p><w:r><w:t>Appendix</w:t></w:r></w:p><w:p><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:p>';
 const step=createParseStep({load:async()=>({original:'eA=='}),entries:()=>[{name:'word/document.xml',bytes:Buffer.from(xml)},{name:'word/_rels/document.xml.rels',bytes:Buffer.from('<Relationships><Relationship Id="rId1" Target="media/image1.png"/></Relationships>')},{name:'word/media/image1.png',bytes:Buffer.from('image')}],decode:x=>x,ocr:async()=> 'Image words.'});
 const job={id:uuid,actor_uid:'staff',input:{documentId:uuid}};
 let calls=0;const generate=async(_job,skill,context,chunk)=>{
  calls++;assert.equal(skill,'reference_parse');assert.equal(chunk,0);assert.equal(context.paragraphs.length,4);
  return {result:{sections:[{start:0,end:1,title:'Budget',kind:'objection'},{start:3,end:3,title:'Image',kind:'wording'}],omitted:[{index:2,reason:'Appendix heading'}]}};
 };
 const first=await step(job,generate);assert.equal(first.done,false);assert.equal(calls,0);assert.equal(first.output.imagesDone,1);
 const second=await step({...job,output:first.output},generate);assert.equal(second.done,true);assert.equal(second.output.cursor,4);
 assert.equal(second.output.lines[1],'Respect refusal.');assert.equal(second.output.sections.length,2);
 const noCoverage=async()=>({result:{sections:[],omitted:[]}});
 const incomplete={...first.output,cursor:0,sections:[],omitted:[]};
 await assert.rejects(step({...job,output:incomplete},noCoverage),/REFERENCE_COVERAGE_INCOMPLETE/);
});

test('scanned DOCX follows relationship order, preserves OCR paragraph boundaries and resumes the failed page',async()=>{
 const xml='<w:p><w:t>Opening</w:t></w:p><w:p><w:drawing><a:blip r:embed="second"/></w:drawing></w:p><w:p><w:t>Between pages</w:t></w:p><w:p><w:drawing><a:blip r:embed="first"/></w:drawing></w:p><w:p><w:t>Closing</w:t></w:p>';
 const files=[{name:'word/document.xml',bytes:Buffer.from(xml)},
  {name:'word/_rels/document.xml.rels',bytes:Buffer.from('<Relationships><Relationship Id="first" Target="media/image1.png"/><Relationship Id="second" Target="media/image2.png"/></Relationships>')},
  ...['image1.png','image2.png','unused.png'].map(name=>({name:'word/media/'+name,bytes:Buffer.from(name)}))];
 const calls=[];let rejectSecond=true;
 const step=createParseStep({load:async()=>({original:'eA=='}),entries:()=>files,decode:x=>x,ocr:async name=>{
  calls.push(name);if(name.endsWith('image1.png')&&rejectSecond)throw Error('temporary OCR failure');
  return name.endsWith('image2.png')?'S1. First\nAnswer one\nS2. Second\nAnswer two\nEND-A':'S3. Third\nAnswer three\nS4. Fourth\nAnswer four\nEND-B';
 }});
 const job={id:uuid,actor_uid:'staff',input:{documentId:uuid}};
 const generate=async(_job,_skill,context)=>({result:{sections:[],omitted:context.paragraphs.map(p=>({index:p.index,reason:'Test coverage'}))}});
 const first=await step(job,generate);assert.equal(first.output.imagesDone,1);assert.equal(first.output.sourceCursor,2);
 assert.deepEqual(first.output.lines,['Opening','S1. First','Answer one','S2. Second','Answer two','END-A']);
 const checkpoint=structuredClone(first.output);
 await assert.rejects(step({...job,output:structuredClone(checkpoint)},generate),/REFERENCE_IMAGE_OCR_FAILED/);
 rejectSecond=false;
 const resumed=await step({...job,output:structuredClone(checkpoint)},generate);
 const done=await step({...job,output:resumed.output},generate);
 assert.equal(done.done,true);assert.equal(done.output.lines.at(-1),'Closing');
 assert.deepEqual(done.output.lines.slice(6),['Between pages','S3. Third','Answer three','S4. Fourth','Answer four','END-B','Closing']);
 assert.equal(done.output.cursor,13);assert.equal(done.output.imagesDone,2);
 assert.deepEqual(calls,['word/media/image2.png','word/media/image1.png','word/media/image1.png']);
 assert.ok(done.output.locations[1].includes('image2.png OCR ¶1'));
 assert.deepEqual(done.output.warnings,[{source:'word/media/unused.png',reason:'image_unreferenced'}]);
});

test('empty image OCR fails visibly and legacy checkpoints restart instead of mixing old page order',async()=>{
 const files=[{name:'word/document.xml',bytes:Buffer.from('<w:p><w:drawing><a:blip r:embed="img"/></w:drawing></w:p>')},
  {name:'word/_rels/document.xml.rels',bytes:Buffer.from('<Relationship Id="img" Target="media/page.png"/>')},
  {name:'word/media/page.png',bytes:Buffer.from('image')}];
 let text='';const step=createParseStep({load:async()=>({original:'eA=='}),entries:()=>files,decode:x=>x,ocr:async()=>text});
 const job={id:uuid,actor_uid:'staff',input:{documentId:uuid},output:{lines:['Old wrong page'],locations:['old'],imagesDone:1,cursor:0}};
 await assert.rejects(step(job,()=>{}),/REFERENCE_IMAGE_OCR_FAILED/);
 text='Actual page\nComplete answer';const r=await step(job,()=>{});
 assert.deepEqual(r.output.lines,['Actual page','Complete answer']);assert.equal(r.output.parserVersion,2);
 assert.ok(r.output.warnings.some(w=>w.reason==='restarted'));
});

test('completed parsing with no importable sections exposes coverage and allows reparse',async()=>{
 const {createManualImport}=require('../../cloudfunctions/assistant/manual-docx-import');let retried=false;
 const svc=createManualImport({rpc:async()=>({data:{id:uuid,original:'eA==',filename:'scan.docx',applied:{}}}),
  extractDocx:()=>({lines:[],headings:[]}),catalog:async()=>[],parse:async(_actor,input)=>{
   retried=input.retry===true;return {job:{status:'completed',output:{cursor:1,lines:['Scan heading'],locations:['page1 OCR ¶1'],sections:[],omitted:[{index:0,reason:'Heading only'}],warnings:[{source:'page2',reason:'image_format'}]}}};
  }});
 const r=await svc.run('preview',{id:uuid},'staff');assert.equal(r.canRetry,true);assert.equal(r.status,'pending');
 assert.equal(r.coverage.omitted[0].text,'Scan heading');assert.equal(r.coverage.omitted[0].source,'page1 OCR ¶1');
 await svc.run('preview',{id:uuid,retry:true},'staff');assert.equal(retried,true);
});

test('failed parse is resumable task state, not a transport error swallowed by the page data adapter',async()=>{
 const {createManualImport}=require('../../cloudfunctions/assistant/manual-docx-import');
 const svc=createManualImport({rpc:async()=>({data:{id:uuid,original:'eA==',filename:'scan.docx',applied:{}}}),
  extractDocx:()=>({lines:[],headings:[]}),catalog:async()=>[],parse:async()=>({job:{status:'failed',last_error:'TIMEOUT',output:{cursor:4,lines:['a','b','c','d','e']}}})});
 const r=await svc.run('preview',{id:uuid},'staff');assert.equal(r.status,'pending');assert.equal(r.failed,true);
 assert.equal(r.failureCode,'TIMEOUT');assert.equal(Object.hasOwn(r,'error'),false);assert.deepEqual(r.progress,{done:4,total:5});
});

test('model-split questions and replies rejoin under explicit source scenarios without consuming footers',async()=>{
 const lines=['S1. Appointment','Customer: busy.','Reply: ask permission.','S2. Contact','Customer: stop.','Reply: respect refusal.','END-A'];
 const xml=lines.map(text=>'<w:p><w:t>'+text+'</w:t></w:p>').join('');
 const step=createParseStep({load:async()=>({original:'eA=='}),entries:()=>[{name:'word/document.xml',bytes:Buffer.from(xml)}],decode:x=>x,ocr:async()=>{throw Error('No images');}});
 const result=await step({id:uuid,actor_uid:'staff',input:{documentId:uuid}},async()=>({result:{
  sections:[{start:1,end:1,title:'Question one',kind:'objection'},{start:2,end:2,title:'Reply one',kind:'wording'},
   {start:4,end:4,title:'Question two',kind:'objection'},{start:5,end:5,title:'Reply two',kind:'wording'}],
  omitted:[{index:0,reason:'heading'},{index:3,reason:'heading'},{index:6,reason:'footer'}]}}));
 assert.deepEqual(result.output.sections,[{start:0,end:2,title:'Appointment',kind:'wording'},{start:3,end:5,title:'Contact',kind:'wording'}]);
 assert.deepEqual(result.output.omitted,[{index:6,reason:'footer'}]);assert.equal(result.output.cursor,7);
});
test('MCP contracts reject injected fields, require dedicated scopes and shared copies match',()=>{
 const fs=require('node:fs'),contract=require('../../cloudfunctions/_shared/reference-mcp-tools');
 assert.equal(contract.validate('reference_gpt_start',{requestId:uuid}),true);
 assert.equal(contract.validate('reference_gpt_start',{requestId:uuid,tool:'knowledge_records_list'}),false);
 assert.equal(contract.validate('reference_gpt_save',{jobId:uuid,title:'x',content:'',note:'x'}),false);
 assert.ok(contract.tools.every(t=>t.securitySchemes[0].scopes.includes('references:read')));
 for(const dir of ['assistant','knowledge_mcp'])assert.equal(fs.readFileSync('cloudfunctions/'+dir+'/reference-mcp-tools.js','utf8'),fs.readFileSync('cloudfunctions/_shared/reference-mcp-tools.js','utf8'));
 const {valid}=require('../../cloudfunctions/assistant/reference-worker-dispatch'),secret='a'.repeat(64);
 assert.equal(valid({Type:'Timer',TriggerName:'referenceOptimizationWorker',Message:secret},secret),true);
 assert.equal(valid({Type:'Timer',TriggerName:'referenceOptimizationWorker',Message:secret+'x'},secret),false);
 assert.equal(valid({action:'referenceWorker',Message:secret},secret),false);
 const {validateScopes}=require('../../cloudfunctions/assistant/knowledge-mcp-auth');
 assert.deepEqual(validateScopes('references:read references:gpt:submit'),['references:read','references:gpt:submit']);
 assert.throws(()=>validateScopes('knowledge:read references:gpt:submit'),/INVALID_SCOPE/);
});
