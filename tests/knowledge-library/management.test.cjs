'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createKnowledgeLibrary}=require('../../cloudfunctions/assistant/knowledge-library-service');

function setup({current=null,manualSummary=false}={}){
  const writes=[],gatewayCalls=[];
  const fetchImpl=async(url,options={})=>{
    const table=new URL(url).pathname.split('/').pop();
    const method=options.method||'GET';
    if(method==='GET')return response(current?[current]:[]);
    const body=JSON.parse(options.body);
    writes.push({table,method,body,url:new URL(url)});
    const row=Array.isArray(body)?body[0]:body;
    return response([{...row,id:current?.id||42,updated_at:'2026-10-27T00:00:00Z'}]);
  };
  const gatewayFactory=()=>({runAITask:async input=>{
    gatewayCalls.push(input);
    return {result:{summary:'AI generated summary'},taskId:12,resultId:34};
  }});
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{}})},gatewayFactory});
  return {service,writes,gatewayCalls};
}
function response(value){return {ok:true,text:async()=>JSON.stringify(value)};}
const base={domain:'product',title:'Product overview',content:'Product content to summarize',sourceDate:'2026-10-01',confidence:.8};

test('new knowledge uses the AI Gateway summary and stores it separately in metadata',async()=>{
  const {service,writes,gatewayCalls}=setup();
  const result=await service.run({operation:'save',data:base},'operator-1');
  assert.equal(result.ok,true);assert.equal(result.summaryGenerated,true);
  assert.equal(gatewayCalls.length,1);assert.equal(gatewayCalls[0].skill,'knowledge_extract');
  assert.equal(writes[0].method,'POST');assert.equal(writes[0].body[0].metadata.summary,'AI generated summary');
  assert.equal(writes[0].body[0].metadata.summary_source,'ai');
  assert.equal(writes[0].body[0].lifecycle_status,'draft');
});

test('manual summary is preserved without invoking AI',async()=>{
  const {service,writes,gatewayCalls}=setup();
  const result=await service.run({operation:'save',data:{...base,summary:'Edited by operator'}},'operator-1');
  assert.equal(result.summaryGenerated,false);assert.equal(gatewayCalls.length,0);
  assert.equal(writes[0].body[0].metadata.summary,'Edited by operator');
  assert.equal(writes[0].body[0].metadata.summary_source,'manual');
});

test('editing verified knowledge creates a linked draft revision and preserves its parent',async()=>{
  const current={id:7,source_id:3,item_type:'product',source:'Old title',content:'Old content',metadata:{domain:'product',summary:'Old summary'},
    lifecycle_status:'verified',verified:true,version_no:2,updated_at:'2026-10-20T00:00:00Z'};
  const {service,writes}=setup({current});
  const result=await service.run({operation:'save',data:{...base,id:'7',expectedUpdatedAt:current.updated_at,summary:'New summary'}},'operator-1');
  assert.equal(result.revision,true);assert.equal(writes[0].method,'POST');
  assert.equal(writes[0].body[0].supersedes_id,7);assert.equal(writes[0].body[0].version_no,3);
  assert.equal(writes[0].body[0].source_id,3);assert.equal(writes[0].body[0].lifecycle_status,'draft');
});

test('editing a draft uses an optimistic timestamp condition',async()=>{
  const current={id:7,item_type:'product',source:'Old title',content:'Old content',metadata:{domain:'product'},
    lifecycle_status:'draft',verified:false,version_no:1,updated_at:'2026-10-20T00:00:00Z'};
  const {service,writes}=setup({current});
  await service.run({operation:'save',data:{...base,id:'7',expectedUpdatedAt:current.updated_at,summary:'Updated'}},'operator-1');
  assert.equal(writes[0].method,'PATCH');
  assert.equal(writes[0].url.searchParams.get('updated_at'),`eq.${current.updated_at}`);
});

test('regulated and top performer categories retain source and privacy safeguards',async()=>{
  const {service,writes}=setup();
  await assert.rejects(service.run({operation:'save',data:{...base,domain:'legal_tax'}},'operator-1'),
    error=>error.code==='SOURCE_METADATA_REQUIRED');
  await assert.rejects(service.run({operation:'save',data:{...base,domain:'top_performer_sharing'}},'operator-1'),
    error=>error.code==='SHARING_AUTHORIZATION_REQUIRED');
  await assert.rejects(service.run({operation:'save',data:{...base,domain:'top_performer_sharing',sharingAuthorized:true,
    anonymized:true,content:'客户电话 13812345678'}},'operator-1'),error=>error.code==='PERSONAL_DATA_DETECTED');
  assert.equal(writes.length,0);
});

test('superseded and invalidated history cannot be silently reopened through the save operation',async()=>{
  for(const lifecycle_status of ['superseded','invalidated']){
    const current={id:8,item_type:'product',source:'Archived note',content:'Old content',metadata:{domain:'product'},
      lifecycle_status,verified:false,version_no:1,updated_at:'2026-10-20T00:00:00Z'};
    const {service,writes}=setup({current});
    await assert.rejects(service.run({operation:'save',data:{...base,id:'8',expectedUpdatedAt:current.updated_at,summary:'Edit'}},'operator-1'),
      error=>error.code==='INVALID_INPUT');
    assert.equal(writes.length,0);
  }
});
