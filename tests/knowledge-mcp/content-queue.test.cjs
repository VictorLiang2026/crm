'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createKnowledgeContentService}=require('../../cloudfunctions/assistant/knowledge-content-service');

function fixture({table='knowledge_items',recordOverrides={}}={}){
 const expectedUpdatedAt='2026-10-31T12:00:00.000Z',calls=[],generated=[];
 const record={table,id:'12',title:'Synthetic fixture',updatedAt:expectedUpdatedAt,sourceFingerprint:null,version:3,
  original:{text:'System stored original',summary:'System summary'},gpt:{summary:null,reviewed:false},...recordOverrides};
 const service=createKnowledgeContentService({rpc:async(_name,args)=>{
  calls.push(args);const op=args.p_operation;
  if(op==='get')return {data:{ok:true,record:{...record,original:{...record.original},gpt:{...record.gpt}}}};
  if(op==='save')return {data:{ok:true,record:{...record,updatedAt:'2026-10-31T12:01:00.000Z'}}};
  throw Error(`Unexpected operation ${op}`);
 },sourceBytes:async()=>{throw Error('Attachment bytes must not be read');},request:async()=>{throw Error('Source records must not be read');},
 generateSummary:async input=>{generated.push(input);return {summary:'Only a summary',taskId:'task-1',resultId:'result-1'};}});
 return {service,calls,generated,record,expectedUpdatedAt,table};
}

test('GPT generation reads stored system text and saves only the GPT summary directly by record ID',async()=>{
 for(const table of ['knowledge_items','playbooks']){
  const f=fixture({table});const result=await f.service.run('queueGpt','crm-user-1',{table,id:'12',expectedUpdatedAt:f.expectedUpdatedAt});
  assert.deepEqual(result,{ok:true,status:'saved',recordId:'12',updatedAt:'2026-10-31T12:01:00.000Z',taskId:'task-1',resultId:'result-1'});
  assert.deepEqual(f.generated,[{domain:'other',title:'Synthetic fixture',content:'System stored original'}]);
  const save=f.calls.find(call=>call.p_operation==='save');
  assert.deepEqual(save.p_data,{table,id:'12',expectedUpdatedAt:f.expectedUpdatedAt,expectedVersion:3,expectedSourceFingerprint:null,
   target:'gpt',patch:{summary:'Only a summary'}});
 }
});

test('GPT generation skips existing summaries without consulting review candidates',async()=>{
 const existing=fixture({recordOverrides:{gpt:{summary:'Already present'}}});
 assert.equal((await existing.service.run('queueGpt','actor',{table:existing.table,id:'12',expectedUpdatedAt:existing.expectedUpdatedAt})).reason,'GPT_SUMMARY_EXISTS');
 assert.equal(existing.calls.some(call=>call.p_operation==='save'),false);
 assert.equal(existing.generated.length,0);
});

test('GPT generation stops for missing source text or stale record versions',async()=>{
 const empty=fixture({recordOverrides:{original:{text:'  '}}});
 await assert.rejects(empty.service.run('queueGpt','actor',{table:empty.table,id:'12',expectedUpdatedAt:empty.expectedUpdatedAt}),{code:'CONTENT_ORIGINAL_REQUIRED'});
 const stale=fixture();await assert.rejects(stale.service.run('queueGpt','actor',{table:stale.table,id:'12',expectedUpdatedAt:'2026-10-30T00:00:00.000Z'}),{code:'CONTENT_STALE'});
 assert.equal(empty.generated.length+stale.generated.length,0);
});

test('GPT generation rejects unsupported types and malformed record IDs before reading',async()=>{
 const f=fixture();
 await assert.rejects(f.service.run('queueGpt','actor',{table:'knowledge_sources',id:'12',expectedUpdatedAt:f.expectedUpdatedAt}),{code:'INVALID_INPUT'});
 await assert.rejects(f.service.run('queueGpt','actor',{table:f.table,id:'0',expectedUpdatedAt:f.expectedUpdatedAt}),{code:'INVALID_INPUT'});
 assert.equal(f.calls.length,0);
});
