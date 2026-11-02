'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKnowledgeContentService } = require('../../cloudfunctions/assistant/knowledge-content-service');

function fixture({table='knowledge_items',recordOverrides={},pending=null,pendingReviewExists=false}={}) {
  const expectedUpdatedAt='2026-10-31T12:00:00.000Z',calls=[],generated=[];
  let currentPending=pending;
  const record={table,id:'12',title:'Synthetic fixture',updatedAt:expectedUpdatedAt,
    original:{text:'System stored original',summary:null},gpt:{summary:null,reviewed:false},version:3,
    ...recordOverrides};
  const service=createKnowledgeContentService({
    rpc:async(_name,args)=>{
      calls.push(args);
      const op=args.p_operation;
      if(op==='get')return {data:{ok:true,record,pending:currentPending,pendingReviewExists:!!currentPending||pendingReviewExists}};
      if(op==='preview')return {data:{ok:true,commandId:'preview-1'}};
      if(op==='apply'){
        currentPending={commandId:'preview-1',after:{gpt:{summary:'Only a summary'}}};
        return {data:{ok:true,commandId:'preview-1',status:'pending_review'}};
      }
      throw new Error(`Unexpected operation ${op}`);
    },
    sourceBytes:async()=>{throw new Error('Attachment bytes must not be read');},
    request:async()=>{throw new Error('Source records must not be read');},
    generateSummary:async input=>{generated.push(input);return {summary:'Only a summary',taskId:'task-1',resultId:'result-1'};},
  });
  return {service,calls,generated,record,expectedUpdatedAt,table};
}

test('summary generation reads only stored system original and creates a pending summary candidate',async()=>{
  for(const table of ['knowledge_items','playbooks']){
    const f=fixture({table});
    const result=await f.service.run('queueGpt','crm-user-1',{table,id:'12',expectedUpdatedAt:f.expectedUpdatedAt});
    assert.deepEqual(result,{ok:true,commandId:'preview-1',status:'pending_review',taskId:'task-1',resultId:'result-1'});
    assert.deepEqual(f.generated,[{domain:'other',title:'Synthetic fixture',content:'System stored original'}]);
    assert.deepEqual(f.calls.filter(call=>['preview','apply'].includes(call.p_operation)).map(call=>call.p_data),[
      {table,id:'12',expectedUpdatedAt:f.expectedUpdatedAt,action:'edit',target:'gpt',patch:{summary:'Only a summary'},reviewed:false},
      {commandId:'preview-1'},
    ]);
  }
});

test('summary generation skips existing summaries and duplicate pending reviews',async()=>{
  const existing=fixture({recordOverrides:{gpt:{summary:'Already present'}}});
  assert.equal((await existing.service.run('queueGpt','actor',{table:existing.table,id:'12',expectedUpdatedAt:existing.expectedUpdatedAt})).reason,'GPT_SUMMARY_EXISTS');
  const pending=fixture({pending:{commandId:'pending-1'}});
  assert.equal((await pending.service.run('queueGpt','actor',{table:pending.table,id:'12',expectedUpdatedAt:pending.expectedUpdatedAt})).reason,'PENDING_REVIEW_EXISTS');
  const anotherActor=fixture({pendingReviewExists:true});
  assert.equal((await anotherActor.service.run('queueGpt','actor',{table:anotherActor.table,id:'12',expectedUpdatedAt:anotherActor.expectedUpdatedAt})).reason,'PENDING_REVIEW_EXISTS');
  assert.equal(existing.generated.length+pending.generated.length+anotherActor.generated.length,0);
});

test('summary generation stops for missing source text or stale record versions',async()=>{
  const empty=fixture({recordOverrides:{original:{text:'  '}}});
  await assert.rejects(empty.service.run('queueGpt','actor',{table:empty.table,id:'12',expectedUpdatedAt:empty.expectedUpdatedAt}),{code:'CONTENT_ORIGINAL_REQUIRED'});
  const stale=fixture();
  await assert.rejects(stale.service.run('queueGpt','actor',{table:stale.table,id:'12',expectedUpdatedAt:'2026-10-30T00:00:00.000Z'}),{code:'CONTENT_STALE'});
  assert.equal(empty.generated.length+stale.generated.length,0);
});

test('summary generation rejects unsupported types and malformed record IDs before reading',async()=>{
  const f=fixture();
  await assert.rejects(f.service.run('queueGpt','actor',{table:'knowledge_sources',id:'12',expectedUpdatedAt:f.expectedUpdatedAt}),{code:'INVALID_INPUT'});
  await assert.rejects(f.service.run('queueGpt','actor',{table:f.table,id:'0',expectedUpdatedAt:f.expectedUpdatedAt}),{code:'INVALID_INPUT'});
  assert.equal(f.calls.length,0);
});
