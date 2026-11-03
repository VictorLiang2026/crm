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
    if(method==='GET'){
      const table=parsed.pathname.split('/').pop(),query=parsed.searchParams;
      if(table!=='person_followup_advice')return response([]);
      if(query.has('gpt_strategy')&&query.get('gpt_strategy')==='is.null'&&row.gpt_strategy)return response([]);
      if(query.has('gpt_product_advice')&&query.get('gpt_product_advice')==='is.null'&&row.gpt_product_advice)return response([]);
      return response([{...row}]);
    }
    if(method==='PATCH'){
      const body=JSON.parse(options.body);writes.push({filters:parsed.searchParams,body});
      Object.assign(row,body);return response([{...row}]);
    }
    throw new Error(`Unexpected method ${method}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{person:{occupation:'顾问',customer_stage:'新客'},recent_interactions:[]}})}});
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

test('system advice sends only the registered personId input while retaining focus in context retrieval',async()=>{
  const row={id:81,person_id:42,client_request_id:'c9e53b08-1f81-421e-83b0-8ff01f94adf9',title:'跟进建议',
    system_title:'跟进建议',system_status:'generating',system_version:0,created_by:'operator',updated_by:'operator',
    created_at:stamp,updated_at:stamp,deleted_at:null};
  let gatewayRequest;
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET',table=new URL(url).pathname.split('/').pop();
    if(method==='GET'){
      const query=new URL(url).searchParams;
      if(table==='person_followup_advice'&&!query.has('client_request_id'))return response([{...row}]);
      return response([]);
    }
    if(method==='POST')return response([{...row}]);
    if(method==='PATCH'){
      Object.assign(row,JSON.parse(options.body));
      return response([{...row}]);
    }
    throw new Error(`Unexpected ${method} ${table}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{person:{occupation:'顾问',customer_stage:'新客'},recent_interactions:[]}})},
    searchDataFactory:()=>({auditRdb:{}}),
    gatewayFactory:()=>({runAITask:async request=>{
      gatewayRequest=request;
      return {taskId:17,result:{title:'沟通下一步',overallStrategy:{summary:'先了解目标',objective:'确认需求',
        nextStep:'安排沟通',clarifyingQuestions:[],sourceRefs:[]},productServiceAdvice:{recommendation:'暂无匹配资料',sourceRefs:[]}}};
    }})});
  const result=await service.run({operation:'adviceGenerate',data:{personId:'42',clientRequestId:row.client_request_id,focus:'确认家庭保障重点'}},'operator');
  assert.equal(result.status,'completed');
  assert.deepEqual(gatewayRequest.input,{personId:'42'});
  assert.equal(gatewayRequest.context.customer_snapshot.person.customer_stage,'新客');
});

test('follow-up advice status recovers a task ID after the async startup response is delayed',async()=>{
  const stamp='2026-11-04T01:00:00.000Z';
  const advice={id:81,person_id:42,client_request_id:'c9e53b08-1f81-421e-83b0-8ff01f94adf9',title:'跟进建议',
    system_title:'跟进建议',system_status:'ready',system_strategy:'沟通策略',system_product_advice:'产品建议',
    system_strategy_sources:[],system_product_sources:[],system_version:1,system_task_id:17,gpt_title:null,
    gpt_strategy:null,gpt_product_advice:null,gpt_strategy_sources:[],gpt_product_sources:[],gpt_status:'pending',
    created_by:'operator',updated_by:'operator',created_at:stamp,updated_at:stamp,deleted_at:null};
  const requests=[];
  const fetchImpl=async(url)=>{
    const parsed=new URL(url),table=parsed.pathname.split('/').pop();requests.push({table,filters:parsed.searchParams});
    if(table==='ai_tasks')return response([{id:17,status:'completed',task_type:'person_followup_advice',
      subject_type:'person',subject_id:'42',created_at:'2026-11-04T01:00:01.000Z'}]);
    if(table==='person_followup_advice')return response([{...advice}]);
    throw new Error(`Unexpected GET ${table}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{}})}});
  const result=await service.run({operation:'adviceStatus',data:{personId:'42',startedAt:'2026-11-04T01:00:00.000Z'}},'operator');
  assert.equal(result.status,'completed');assert.equal(result.taskId,'17');assert.equal(result.adviceId,'81');
  assert.equal(requests[0].table,'ai_tasks');assert.equal(requests[0].filters.get('task_type'),'eq.person_followup_advice');
  assert.equal(requests[1].filters.get('system_task_id'),'eq.17');
});

test('follow-up advice status stays pending while a slow startup has not created an AI task yet',async()=>{
  let adviceQueries=0;
  const fetchImpl=async(url)=>{
    const table=new URL(url).pathname.split('/').pop();
    if(table==='ai_tasks')return response([]);
    if(table==='person_followup_advice'){adviceQueries++;return response([]);}
    throw new Error(`Unexpected GET ${table}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{}})}});
  const result=await service.run({operation:'adviceStatus',data:{personId:'42',startedAt:'2026-11-04T01:00:00.000Z'}},'operator');
  assert.deepEqual(result,{ok:true,status:'pending',taskId:'',personId:'42'});assert.equal(adviceQueries,0);
});

test('paired row edit updates both lanes atomically and leaves unchanged GPT marked stale after a system change',async()=>{
  const {service,row,writes}=setup();
  const result=await service.run({operation:'adviceUpdate',data:{id:'81',personId:'42',lane:'pair',gptAction:'keep',
    systemVersion:2,updatedAt:stamp,title:'系统新标题',strategy:'系统新策略',productAdvice:'系统新产品建议'}},'operator');
  assert.equal(writes.length,1);
  assert.equal(writes[0].body.system_version,3);
  assert.equal(writes[0].body.gpt_status,'stale');
  assert.equal(result.advice.gpt.strategy,'GPT 策略');
  assert.equal(row.gpt_strategy,'GPT 策略');
});

test('paired row edit can clear GPT content for the next empty-only skill package',async()=>{
  const {service,row,writes}=setup();
  const result=await service.run({operation:'adviceUpdate',data:{id:'81',personId:'42',lane:'pair',gptAction:'delete',
    systemVersion:2,updatedAt:stamp,title:'系统标题',strategy:'系统策略',productAdvice:'系统产品建议'}},'operator');
  assert.equal(writes.length,1);
  assert.equal(row.gpt_strategy,null);assert.equal(row.gpt_product_advice,null);
  assert.equal(result.advice.gpt.status,'pending');
  assert.deepEqual(writes[0].body.gpt_strategy_sources,[]);
});

test('paired row edit changes existing GPT content without changing the CloudBase lane',async()=>{
  const {service,row,writes}=setup();
  const result=await service.run({operation:'adviceUpdate',data:{id:'81',personId:'42',lane:'pair',gptAction:'edit',
    systemVersion:2,updatedAt:stamp,title:'系统标题',strategy:'系统策略',productAdvice:'系统产品建议',
    gptTitle:'GPT 新标题',gptStrategy:'GPT 新策略',gptProductAdvice:'GPT 新产品建议'}},'operator');
  assert.equal(writes.length,1);assert.equal(row.system_strategy,'系统策略');
  assert.equal(row.gpt_title,'GPT 新标题');assert.equal(row.gpt_strategy,'GPT 新策略');
  assert.equal(row.gpt_status,'manual');assert.equal(row.gpt_based_on_system_version,2);
  assert.equal(result.advice.system.strategy,'系统策略');assert.equal(result.advice.gpt.productAdvice,'GPT 新产品建议');
});

test('GPT task package selects empty GPT lanes and excludes non-empty stale advice',async()=>{
  const {service,row}=setup();
  let result=await service.run({operation:'gptTaskPackage',data:{limit:10}},'operator');
  assert.equal(result.count,0);
  row.gpt_title=null;row.gpt_strategy=null;row.gpt_product_advice=null;
  row.gpt_status='pending';row.gpt_based_on_system_version=null;
  result=await service.run({operation:'gptTaskPackage',data:{limit:10}},'operator');
  assert.equal(result.count,1);assert.equal(result.rows[0].adviceId,'81');
});

test('GPT import preview refuses to overwrite a non-empty GPT lane',async()=>{
  const {service,writes}=setup();
  const result=await service.run({operation:'gptImportPreview',data:{rows:[{adviceId:'81',personId:'42',systemVersion:2,
    gptAdvice:{title:'GPT 新标题',overallStrategy:'GPT 新策略',productServiceAdvice:'GPT 新产品建议',
      strategySourceIds:[],productSourceIds:[]}}]}},'operator');
  assert.equal(result.rows[0].status,'not_empty');assert.equal(writes.length,0);
});

test('GPT import confirmation cannot write over content filled after preview',async()=>{
  const {service,row,writes}=setup();row.gpt_preview_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  row.gpt_preview_actor='operator';row.gpt_preview_expires_at='2999-01-01T00:00:00.000Z';
  row.gpt_preview_payload={title:'覆盖标题',strategy:'覆盖策略',product:'覆盖产品',strategySources:[],productSources:[],systemVersion:2};
  await assert.rejects(service.run({operation:'gptImportConfirm',data:{confirmed:true,adviceId:'81',personId:'42',
    systemVersion:2,previewId:row.gpt_preview_id}},'operator'),error=>error.code==='STALE');
  assert.equal(writes.length,0);assert.equal(row.gpt_strategy,'GPT 策略');
});
