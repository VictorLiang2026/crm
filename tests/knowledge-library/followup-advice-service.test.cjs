'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createKnowledgeLibrary}=require('../../cloudfunctions/assistant/knowledge-library-service');

const stamp='2026-10-31T01:00:00.000Z';
function setup(){
  const row={id:81,person_id:42,client_request_id:'c9e53b08-1f81-421e-83b0-8ff01f94adf9',title:'系统标题',system_title:'系统标题',gpt_title:'GPT 标题',
    system_status:'ready',system_strategy:'系统策略',system_product_advice:'系统产品建议',system_strategy_sources:[],system_product_sources:[],
    system_version:2,system_task_id:12,gpt_strategy:'GPT 策略',gpt_product_advice:'GPT 产品建议',gpt_strategy_sources:[15],gpt_product_sources:[16],
    gpt_based_on_system_version:1,gpt_kept_for_system_version:null,gpt_status:'stale',gpt_preview_id:null,gpt_preview_payload:null,
    gpt_preview_actor:null,gpt_preview_expires_at:null,created_by:'operator',updated_by:'operator',created_at:stamp,updated_at:stamp,deleted_at:null};
  const writes=[];
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET',parsed=new URL(url);
    if(method==='GET')return response([{...row}]);
    if(method==='PATCH'){
      const body=JSON.parse(options.body);writes.push({filters:parsed.searchParams,body});
      Object.assign(row,body);return response([{...row}]);
    }
    throw new Error(`Unexpected method ${method}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{}})}});
  return {service,row,writes};
}
function response(value){return {ok:true,text:async()=>JSON.stringify(value)};}

test('system lane edits update its title and content while keeping GPT and marking its basis stale',async()=>{
  const {service,row,writes}=setup();
  const result=await service.run({operation:'adviceUpdate',data:{id:'81',personId:'42',lane:'system',action:'edit',
    systemVersion:2,updatedAt:stamp,title:'新系统标题',strategy:'新的整体策略',productAdvice:'新的产品建议'}},'operator');
  assert.equal(result.advice.system.title,'新系统标题');assert.equal(result.advice.title,'新系统标题');
  assert.equal(result.advice.system.version,3);assert.equal(result.advice.gpt.title,'GPT 标题');
  assert.equal(row.gpt_strategy,'GPT 策略');assert.equal(row.gpt_status,'stale');assert.equal(row.gpt_based_on_system_version,1);
  assert.equal(writes[0].body.title,'新系统标题');assert.equal(writes[0].body.system_title,'新系统标题');
});

test('GPT lane deletion clears only GPT fields and returns the paired row to pending',async()=>{
  const {service,row,writes}=setup();
  const result=await service.run({operation:'adviceUpdate',data:{id:'81',personId:'42',lane:'gpt',action:'delete',
    systemVersion:2,updatedAt:stamp}},'operator');
  assert.equal(result.advice.system.title,'系统标题');assert.equal(result.advice.system.version,2);
  assert.equal(result.advice.gpt.title,'');assert.equal(result.advice.gpt.strategy,'');assert.equal(result.advice.gpt.status,'pending');
  assert.equal(row.title,'系统标题');assert.equal(row.system_strategy,'系统策略');assert.equal(row.gpt_strategy,null);
  assert.equal(row.gpt_product_advice,null);assert.equal(row.gpt_based_on_system_version,null);
  assert.deepEqual(writes[0].body.gpt_strategy_sources,[]);assert.equal(writes[0].body.deleted_at,undefined);
});

test('GPT lane edit leaves the CloudBase lane and system version unchanged',async()=>{
  const {service,row}=setup();
  const result=await service.run({operation:'adviceUpdate',data:{id:'81',personId:'42',lane:'gpt',action:'edit',
    systemVersion:2,updatedAt:stamp,title:'GPT 新标题',strategy:'GPT 新策略',productAdvice:'GPT 新产品建议'}},'operator');
  assert.equal(result.advice.gpt.title,'GPT 新标题');assert.equal(result.advice.gpt.status,'manual');
  assert.equal(result.advice.gpt.basedOnSystemVersion,2);assert.equal(result.advice.system.version,2);
  assert.equal(row.system_title,'系统标题');assert.equal(row.system_strategy,'系统策略');
});
