'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReferenceOptimization}=require('../../cloudfunctions/assistant/reference-optimization-service');
const {createParseStep}=require('../../cloudfunctions/assistant/reference-manual-parser');
const registry=require('../../cloudfunctions/assistant/reference-optimization-skills');
const uuid='11111111-1111-1111-1111-111111111111';
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
 const xml='<w:p><w:r><w:t>1. Budget</w:t></w:r></w:p><w:p><w:r><w:t>Respect refusal.</w:t></w:r></w:p><w:p><w:r><w:t>Appendix</w:t></w:r></w:p>';
 const step=createParseStep({load:async()=>({original:'eA=='}),entries:()=>[{name:'word/document.xml',bytes:Buffer.from(xml)},{name:'word/media/image1.png',bytes:Buffer.from('image')}],decode:x=>x,ocr:async()=> 'Image words.'});
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
