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
  const writes=[],reads=[];
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET',parsed=new URL(url);
    if(method==='GET'){
      const table=parsed.pathname.split('/').pop(),query=parsed.searchParams;
      if(table!=='person_followup_advice')return response([]);
      reads.push(query);
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
    testDataReader:async()=>({status:'verified',containsTestData:false,recordCount:0,sources:[]}),
    client:{callFunction:async()=>({result:{person:{display_name:'测试客户',occupation:'顾问',customer_stage:'新客'},
      household:{important_facts:'测试客户的家庭情况',members:[{name:'家属姓名',role:'配偶',phone:'13800138000'}]},
      relationship:[{other_person_id:91,other_name:'关联人物姓名',type:'合作关系',stage:'建立联系'}],
      recent_interactions:[],open_actions:[{title:'确认安排',owner_name:'测试客户'}],commitments:[{content:'回传材料',email:'test@example.com'}],
      relevant_playbook:{status:'available',content:{relevant_playbooks:[{scenario:'初次沟通',response_logic:'先确认关注点'}]}}}})}});
  return {service,row,writes,reads};
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

test('advice list uses bounded limit/offset pagination and rejects invalid page values',async()=>{
  const {service,reads}=setup();
  const page=await service.run({operation:'adviceList',personId:'42',limit:25,offset:50},'operator');
  assert.equal(page.limit,25);assert.equal(page.offset,50);assert.equal(page.hasMore,false);
  assert.equal(reads.at(-1).get('limit'),'26');assert.equal(reads.at(-1).get('offset'),'50');
  await assert.rejects(service.run({operation:'adviceList',personId:'42',limit:0},'operator'),error=>error.code==='INVALID_INPUT');
  await assert.rejects(service.run({operation:'adviceList',personId:'42',limit:101},'operator'),error=>error.code==='INVALID_INPUT');
  await assert.rejects(service.run({operation:'adviceList',personId:'42',offset:-1},'operator'),error=>error.code==='INVALID_INPUT');
});

test('advice list recovers a legacy GPT WeChat section with compact CRLF separators without writing data',async()=>{
  const {service,row,writes}=setup();
  const legacy='GPT 产品建议\r\n---\r\n微信沟通话术：\r\n刘老师您好，方便时想和您确认一下近期安排。';
  row.gpt_product_advice=legacy;
  const result=await service.run({operation:'adviceList',personId:'42'},'operator');
  assert.equal(result.rows[0].gpt.productAdvice,'GPT 产品建议');
  assert.equal(result.rows[0].gpt.messageDraft,'刘老师您好，方便时想和您确认一下近期安排。');
  assert.equal(row.gpt_product_advice,legacy);
  assert.equal(writes.length,0);
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

test('GPT message edits are stored in the existing advice field and can be cleared',async()=>{
  const {service,row,writes}=setup();
  row.gpt_product_advice='GPT 产品建议\n\n---\n\n微信沟通话术：\n旧 GPT 话术';
  const updated=await service.run({operation:'adviceUpdate',data:{id:'81',personId:'42',lane:'gpt',action:'edit',
    systemVersion:2,updatedAt:stamp,title:'GPT 新标题',strategy:'GPT 新策略',productAdvice:'GPT 新产品建议',
    gptMessageDraft:'更新后的 GPT 微信话术'}},'operator');
  assert.equal(updated.advice.gpt.messageDraft,'更新后的 GPT 微信话术');
  assert.match(row.gpt_product_advice,/GPT 新产品建议[\s\S]*更新后的 GPT 微信话术/);
  await service.run({operation:'adviceUpdate',data:{id:'81',personId:'42',lane:'gpt',action:'edit',
    systemVersion:2,updatedAt:row.updated_at,title:'GPT 新标题',strategy:'GPT 新策略',productAdvice:'GPT 新产品建议',gptMessageDraft:''}},'operator');
  assert.equal(writes.length,2);assert.equal(row.gpt_product_advice,'GPT 新产品建议');
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
        nextStep:'安排沟通',clarifyingQuestions:[],sourceRefs:[]},productServiceAdvice:{recommendation:'暂无匹配资料',sourceRefs:[]},
        wechatMessage:'您好，想和您确认一下近期最关注的安排，方便时我们再继续聊。'}};
    }})});
  const result=await service.run({operation:'adviceGenerate',data:{personId:'42',clientRequestId:row.client_request_id,focus:'确认家庭保障重点'}},'operator');
  assert.equal(result.status,'completed');
  assert.equal(result.advice.system.productAdvice,'暂无匹配资料');
  assert.equal(result.advice.system.messageDraft,'您好，想和您确认一下近期最关注的安排，方便时我们再继续聊。');
  assert.match(row.system_product_advice,/\n\n---\n\n微信沟通话术：\n/);
  assert.deepEqual(gatewayRequest.input,{personId:'42'});
  assert.equal(gatewayRequest.context.customer_snapshot.person.customer_stage,'新客');
  assert.match(gatewayRequest.context.generation_rules,/Simplified Chinese \(zh-CN\)/);
  assert.match(gatewayRequest.context.generation_rules,/three separate sections: overallStrategy, productServiceAdvice, and wechatMessage/);
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

test('system advice excludes confirmed test sources and continues with clean knowledge',async()=>{
  const row={id:82,person_id:42,client_request_id:'d9e53b08-1f81-421e-83b0-8ff01f94adf9',title:'跟进建议',
    system_title:'跟进建议',system_status:'generating',system_version:0,created_by:'operator',updated_by:'operator',
    created_at:stamp,updated_at:stamp,deleted_at:null};
  let gatewayRequest;const items=[
    {id:3,source_id:null,item_type:'story',source:'行业分享',source_date:'2026-10-26',verified:true,
      lifecycle_status:'verified',version_no:1,content:'家庭财富规划沟通经验',metadata:{domain:'top_performer_sharing',categories:['top_performer_sharing']},
      deleted_at:null,valid_from:null,valid_to:null},
    {id:4,source_id:null,item_type:'evidence',source:'一般行业经验',source_date:'2026-10-26',verified:true,
      lifecycle_status:'verified',version_no:1,content:'以客户明确目标为基础，逐步沟通',metadata:{domain:'industry',categories:['industry_development']},
      deleted_at:null,valid_from:null,valid_to:null},
    {id:5,source_id:null,item_type:'company',source:'已核实公司服务',source_date:'2026-10-26',verified:true,
      lifecycle_status:'verified',version_no:1,content:'提供养老规划咨询服务',metadata:{domain:'company',categories:['company_information']},
      deleted_at:null,valid_from:null,valid_to:null},
  ];
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET',parsed=new URL(url),table=parsed.pathname.split('/').pop(),query=parsed.searchParams;
    if(method==='GET'){
      if(table==='knowledge_items')return response(items.map(item=>({...item})));
      if(table==='knowledge_sources')return response([]);
      if(table==='person_followup_advice')return response(query.has('client_request_id')?[]:[{...row}]);
      return response([]);
    }
    if(method==='POST')return response([{...row}]);
    if(method==='PATCH'){Object.assign(row,JSON.parse(options.body));return response([{...row}]);}
    throw new Error(`Unexpected ${method} ${table}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{person:{occupation:'顾问',customer_stage:'新客'},recent_interactions:[]}})},
    testDataReader:async refs=>{const contains=refs.some(ref=>ref.id==='3');return {status:'verified',containsTestData:contains,
      recordCount:contains?1:0,sources:contains?[{batchKey:'crm_test_fixture',table:'knowledge_items',count:1}]:[]};},
    searchDataFactory:()=>({auditRdb:{}}),gatewayFactory:()=>({runAITask:async request=>{
      gatewayRequest=request;
      return {taskId:27,result:{title:'沟通下一步',overallStrategy:{summary:'先确认客户目标',objective:'核实需求',
        nextStep:'预约沟通',clarifyingQuestions:[],sourceRefs:['4']},
        productServiceAdvice:{recommendation:'结合已核实资料介绍适用服务',sourceRefs:['5']},
        wechatMessage:'您好，方便时我们可以再确认一下您当前的关注点。'}};
    }})});
  const result=await service.run({operation:'adviceGenerate',data:{personId:'42',clientRequestId:row.client_request_id}},'operator');
  assert.equal(result.status,'completed');assert.equal(row.system_status,'ready');
  assert.deepEqual(gatewayRequest.context.strategy_sources.map(ref=>ref.id),['4']);
  assert.deepEqual(gatewayRequest.context.product_sources.map(ref=>ref.id),['5']);
});

test('system advice fails closed when test-data provenance cannot be verified',async()=>{
  const row={id:83,person_id:42,client_request_id:'e9e53b08-1f81-421e-83b0-8ff01f94adf9',title:'跟进建议',
    system_title:'跟进建议',system_status:'generating',system_version:0,created_by:'operator',updated_by:'operator',
    created_at:stamp,updated_at:stamp,deleted_at:null};
  let gatewayCalls=0;
  const item={id:4,source_id:null,item_type:'story',source:'行业分享',source_date:'2026-10-26',verified:true,
    lifecycle_status:'verified',version_no:1,content:'普通行业经验',metadata:{domain:'industry',categories:['industry_development']},
    deleted_at:null,valid_from:null,valid_to:null};
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET',parsed=new URL(url),table=parsed.pathname.split('/').pop();
    if(method==='GET'){
      if(table==='knowledge_items')return response([{...item}]);
      if(table==='knowledge_sources')return response([]);
      if(table==='person_followup_advice')return response(parsed.searchParams.has('client_request_id')?[]:[{...row}]);
      return response([]);
    }
    if(method==='POST')return response([{...row}]);
    if(method==='PATCH'){Object.assign(row,JSON.parse(options.body));return response([{...row}]);}
    throw new Error(`Unexpected ${method} ${table}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{person:{occupation:'顾问',customer_stage:'新客'},recent_interactions:[]}})},
    testDataReader:async()=>({status:'unverified',containsTestData:null,recordCount:null,sources:[]}),
    searchDataFactory:()=>({auditRdb:{}}),gatewayFactory:()=>({runAITask:async()=>{gatewayCalls++;throw new Error('must not call model');}})});
  await assert.rejects(service.run({operation:'adviceGenerate',data:{personId:'42',clientRequestId:row.client_request_id}},'operator'),
    error=>error.code==='TEST_DATA_SCOPE_UNVERIFIED');
  assert.equal(gatewayCalls,0);assert.equal(row.system_status,'failed');
});

test('system advice never persists explicit fictional-test output from the model',async()=>{
  const row={id:84,person_id:42,client_request_id:'f9e53b08-1f81-421e-83b0-8ff01f94adf9',title:'跟进建议',
    system_title:'跟进建议',system_status:'generating',system_version:0,created_by:'operator',updated_by:'operator',
    created_at:stamp,updated_at:stamp,deleted_at:null};
  const item={id:5,source_id:null,item_type:'story',source:'行业经验',source_date:'2026-10-26',verified:true,
    lifecycle_status:'verified',version_no:1,content:'一般行业经验',metadata:{domain:'industry',categories:['industry_development']},
    deleted_at:null,valid_from:null,valid_to:null};
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET',parsed=new URL(url),table=parsed.pathname.split('/').pop();
    if(method==='GET'){
      if(table==='knowledge_items')return response([{...item}]);
      if(table==='knowledge_sources')return response([]);
      if(table==='person_followup_advice')return response(parsed.searchParams.has('client_request_id')?[]:[{...row}]);
      return response([]);
    }
    if(method==='POST')return response([{...row}]);
    if(method==='PATCH'){Object.assign(row,JSON.parse(options.body));return response([{...row}]);}
    throw new Error(`Unexpected ${method} ${table}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{person:{occupation:'顾问',customer_stage:'新客'},recent_interactions:[]}})},
    testDataReader:async()=>({status:'verified',containsTestData:false,recordCount:0,sources:[]}),
    searchDataFactory:()=>({auditRdb:{}}),gatewayFactory:()=>({runAITask:async()=>({
      taskId:18,result:{title:'虚构测试客户跟进建议',
        overallStrategy:{summary:'测试样本',objective:'确认',nextStep:'沟通',clarifyingQuestions:[],sourceRefs:[]},
        productServiceAdvice:{recommendation:'暂无匹配资料',sourceRefs:[]},wechatMessage:'【系统测试·勿联系】虚构话术'}
    })})});
  await assert.rejects(service.run({operation:'adviceGenerate',data:{personId:'42',clientRequestId:row.client_request_id}},'operator'),
    error=>error.code==='TEST_DATA_OUTPUT_BLOCKED');
  assert.equal(row.system_status,'failed');assert.equal(row.system_strategy,undefined);
});

test('GPT import preview refuses registered test knowledge references before preview writes',async()=>{
  const writes=[];
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',
    fetchImpl:async(url,options={})=>{
      if((options.method||'GET')==='PATCH')writes.push(url);
      return response([]);
    },
    client:{callFunction:async()=>({result:{}})},
    searchDataFactory:()=>({auditRdb:{rpc:async()=>({data:{}})}}),
    testDataReader:async refs=>({status:'verified',containsTestData:refs.some(ref=>ref.id==='3'),recordCount:1,
      sources:[{batchKey:'crm_test_fixture',table:'knowledge_items',count:1}]})});
  await assert.rejects(service.run({operation:'gptImportPreview',data:{rows:[{adviceId:'81',personId:'42',systemVersion:1,
    gptAdvice:{title:'GPT建议',overallStrategy:'策略',productServiceAdvice:'产品',strategySourceIds:[3],productSourceIds:[]}}]}},'operator'),
    error=>error.code==='TEST_DATA_BLOCKED');
  assert.equal(writes.length,0);
});

test('follow-up advice status stays pending while startup has no task or advice row yet',async()=>{
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
  assert.deepEqual(result,{ok:true,status:'pending',taskId:'',personId:'42'});assert.equal(adviceQueries,1);
});

test('follow-up advice status reports a pre-task failure instead of polling forever',async()=>{
  let adviceFilter;
  const fetchImpl=async(url)=>{
    const parsed=new URL(url),table=parsed.pathname.split('/').pop();
    if(table==='ai_tasks')return response([]);
    if(table==='person_followup_advice'){
      adviceFilter=parsed.searchParams;
      return response([{id:91,person_id:42,system_status:'failed',created_at:'2026-11-04T01:00:01.000Z'}]);
    }
    throw new Error(`Unexpected GET ${table}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{}})}});
  const result=await service.run({operation:'adviceStatus',data:{personId:'42',startedAt:'2026-11-04T01:00:00.000Z'}},'operator');
  assert.deepEqual(result,{ok:false,status:'failed',taskId:'',personId:'42',adviceId:'91',error:{code:'AI_REQUEST_FAILED'}});
  assert.equal(adviceFilter.get('created_at'),'gte.2026-11-04T01:00:00.000Z');
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

test('paired edit preserves GPT message when omitted and updates it when supplied',async()=>{
  const {service,row}=setup();row.gpt_product_advice='GPT 产品建议\n\n---\n\n微信沟通话术：\n原话术';
  let result=await service.run({operation:'adviceUpdate',data:{id:'81',personId:'42',lane:'pair',gptAction:'keep',
    systemVersion:2,updatedAt:stamp,title:'系统标题',strategy:'系统策略',productAdvice:'系统产品建议'}},'operator');
  assert.equal(result.advice.gpt.messageDraft,'原话术');
  result=await service.run({operation:'adviceUpdate',data:{id:'81',personId:'42',lane:'pair',gptAction:'edit',
    systemVersion:2,updatedAt:row.updated_at,title:'系统标题',strategy:'系统策略',productAdvice:'系统产品建议',
    gptTitle:'GPT 标题',gptStrategy:'GPT 策略',gptProductAdvice:'GPT 产品建议',gptMessageDraft:'新话术'}},'operator');
  assert.equal(result.advice.gpt.messageDraft,'新话术');
});

test('GPT task package selects empty GPT lanes and excludes non-empty stale advice',async()=>{
  const {service,row,reads}=setup();
  let result=await service.run({operation:'gptTaskPackage',data:{limit:10}},'operator');
  assert.equal(result.count,0);
  row.gpt_title=null;row.gpt_strategy=null;row.gpt_product_advice=null;
  row.gpt_status='pending';row.gpt_based_on_system_version=null;
  result=await service.run({operation:'gptTaskPackage',data:{personId:'42',limit:10}},'operator');
  assert.equal(result.count,1);assert.equal(result.rows[0].adviceId,'81');
  assert.equal(reads.at(-1).get('person_id'),'eq.42');
  assert.equal(result.rows[0].customerSnapshot.household.members[0].role,'配偶');
  assert.doesNotMatch(JSON.stringify(result.rows[0]),/家属姓名|关联人物姓名|13800138000|test@example\.com|91/);
  assert.deepEqual(result.rows[0].customerSnapshot.open_actions,[{title:'确认安排'}]);
  assert.equal(result.rows[0].customerSnapshot.relevant_playbook.content.relevant_playbooks[0].scenario,'初次沟通');
});

test('GPT task package rejects invalid IDs and paging limits instead of broadening scope',async()=>{
  const {service,reads}=setup();
  await assert.rejects(service.run({operation:'gptTaskPackage',data:{personId:'0'}},'operator'),error=>error.code==='INVALID_INPUT');
  await assert.rejects(service.run({operation:'gptTaskPackage',data:{limit:11}},'operator'),error=>error.code==='INVALID_INPUT');
  assert.equal(reads.length,0);
});

test('GPT import preview refuses to overwrite a non-empty GPT lane',async()=>{
  const {service,writes}=setup();
  const result=await service.run({operation:'gptImportPreview',data:{rows:[{adviceId:'81',personId:'42',systemVersion:2,
    gptAdvice:{title:'GPT 新标题',overallStrategy:'GPT 新策略',productServiceAdvice:'GPT 新产品建议',
      strategySourceIds:[],productSourceIds:[]}}]}},'operator');
  assert.equal(result.rows[0].status,'not_empty');assert.equal(writes.length,0);
});

test('GPT import preview and confirmed save update only the empty GPT lane',async()=>{
  const {service,row,writes}=setup();
  row.gpt_title=null;row.gpt_strategy=null;row.gpt_product_advice=null;row.gpt_status='pending';
  const preview=await service.run({operation:'gptImportPreview',data:{rows:[{adviceId:'81',personId:'42',systemVersion:2,
    gptAdvice:{title:'GPT 建议',overallStrategy:'先确认当前关注点，再约定下一步沟通。',
      productServiceAdvice:'当前资料不足以核实产品匹配，应先确认保障需求。',wechatMessage:'您好，方便时我们可以确认一下您当前最关注的安排。',
      strategySourceIds:[],productSourceIds:[]}}]}},'operator');
  assert.equal(preview.rows[0].status,'preview');
  assert.equal(preview.rows[0].gptAdvice.wechatMessage,'您好，方便时我们可以确认一下您当前最关注的安排。');
  const confirmed=await service.run({operation:'gptImportConfirm',data:{confirmed:true,adviceId:'81',personId:'42',
    systemVersion:2,previewId:preview.rows[0].previewId}},'operator');
  assert.equal(confirmed.ok,true);
  assert.equal(confirmed.advice.gpt.strategy,'先确认当前关注点，再约定下一步沟通。');
  assert.equal(confirmed.advice.gpt.productAdvice,'当前资料不足以核实产品匹配，应先确认保障需求。');
  assert.equal(confirmed.advice.gpt.messageDraft,'您好，方便时我们可以确认一下您当前最关注的安排。');
  assert.match(row.gpt_product_advice,/微信沟通话术：\n您好/);
  assert.equal(confirmed.advice.system.strategy,'系统策略');
  assert.equal(confirmed.advice.system.productAdvice,'系统产品建议');
  assert.equal(row.gpt_based_on_system_version,2);
  assert.equal(row.gpt_status,'ready');
  assert.equal(row.gpt_preview_id,null);
  assert.equal(writes.length,2);
});

test('GPT import preview rejects test markers in WeChat drafts before writing',async()=>{
  const {service,row,writes}=setup();row.gpt_title=null;row.gpt_strategy=null;row.gpt_product_advice=null;row.gpt_status='pending';
  await assert.rejects(service.run({operation:'gptImportPreview',data:{rows:[{adviceId:'81',personId:'42',systemVersion:2,
    gptAdvice:{title:'GPT 建议',overallStrategy:'策略',productServiceAdvice:'产品',wechatMessage:'【系统测试·勿联系】样本文案',
      strategySourceIds:[],productSourceIds:[]}}]}},'operator'),error=>error.code==='TEST_DATA_OUTPUT_BLOCKED');
  assert.equal(writes.length,0);
});

test('GPT import confirmation cannot write over content filled after preview',async()=>{
  const {service,row,writes}=setup();row.gpt_preview_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  row.gpt_preview_actor='operator';row.gpt_preview_expires_at='2999-01-01T00:00:00.000Z';
  row.gpt_preview_payload={title:'覆盖标题',strategy:'覆盖策略',product:'覆盖产品',strategySources:[],productSources:[],systemVersion:2};
  await assert.rejects(service.run({operation:'gptImportConfirm',data:{confirmed:true,adviceId:'81',personId:'42',
    systemVersion:2,previewId:row.gpt_preview_id}},'operator'),error=>error.code==='STALE');
  assert.equal(writes.length,0);assert.equal(row.gpt_strategy,'GPT 策略');
});

test('direct GPT save writes only an empty ready GPT lane and leaves system advice unchanged',async()=>{
  const {service,row,writes}=setup();
  row.gpt_title=null;row.gpt_strategy=null;row.gpt_product_advice=null;row.gpt_status='pending';
  const result=await service.run({operation:'gptAdviceDirectSave',data:{rows:[{adviceId:'81',personId:'42',systemVersion:2,
    gptAdvice:{title:'直接生成建议',overallStrategy:'先确认当前重点，再商定下一步。',
      productServiceAdvice:'目前无法核实适配产品，应先补充需求信息。',wechatMessage:'不应绕过确认流程',
      strategySourceIds:[],productSourceIds:[]}}]}},'operator');
  assert.equal(result.savedCount,1);assert.equal(result.skippedCount,0);
  assert.equal(result.rows[0].status,'saved');assert.equal(result.rows[0].advice.id,'81');
  assert.equal(row.gpt_title,'直接生成建议');assert.equal(row.gpt_strategy,'先确认当前重点，再商定下一步。');
  assert.equal(row.gpt_product_advice,'目前无法核实适配产品，应先补充需求信息。');
  assert.equal(row.gpt_based_on_system_version,2);assert.equal(row.gpt_status,'ready');
  assert.equal(row.system_strategy,'系统策略');assert.equal(row.system_product_advice,'系统产品建议');
  assert.equal(row.updated_by,'operator');assert.equal(writes.length,1);
  assert.equal(writes[0].filters.get('system_version'),'eq.2');
  assert.equal(writes[0].filters.get('gpt_strategy'),'is.null');
  assert.equal(writes[0].filters.get('gpt_product_advice'),'is.null');
});

test('direct GPT save skips already-filled and stale advice without overwriting',async()=>{
  const {service,row,writes}=setup();
  const nonempty=await service.run({operation:'gptAdviceDirectSave',data:{rows:[{adviceId:'81',personId:'42',systemVersion:2,
    gptAdvice:{title:'覆盖',overallStrategy:'覆盖',productServiceAdvice:'覆盖',strategySourceIds:[],productSourceIds:[]}}]}},'operator');
  assert.equal(nonempty.rows[0].status,'not_empty');
  row.gpt_title=null;row.gpt_strategy=null;row.gpt_product_advice=null;
  const stale=await service.run({operation:'gptAdviceDirectSave',data:{rows:[{adviceId:'81',personId:'42',systemVersion:1,
    gptAdvice:{title:'旧版本',overallStrategy:'旧版本',productServiceAdvice:'旧版本',strategySourceIds:[],productSourceIds:[]}}]}},'operator');
  assert.equal(stale.rows[0].status,'stale');assert.equal(writes.length,0);
});

test('direct GPT save rejects unverified sources and duplicate advice IDs before writing',async()=>{
  const {service,row:writesRow,writes}=setup();
  writesRow.gpt_title=null;writesRow.gpt_strategy=null;writesRow.gpt_product_advice=null;
  const row={adviceId:'81',personId:'42',systemVersion:2,gptAdvice:{title:'建议',overallStrategy:'策略',
    productServiceAdvice:'建议',strategySourceIds:[999],productSourceIds:[]}};
  await assert.rejects(service.run({operation:'gptAdviceDirectSave',data:{rows:[row]}},'operator'),error=>error.code==='INVALID_SOURCE');
  await assert.rejects(service.run({operation:'gptAdviceDirectSave',data:{rows:[{...row,gptAdvice:{...row.gptAdvice,strategySourceIds:[]}},
    {...row,gptAdvice:{...row.gptAdvice,strategySourceIds:[]}}]}},'operator'),error=>error.code==='INVALID_INPUT');
  assert.equal(writes.length,0);
});

test('direct GPT save keeps two advice rows for one Person paired by exact advice ID',async()=>{
  const rows=[81,82].map(id=>({id,person_id:42,title:`系统建议 ${id}`,system_title:`系统建议 ${id}`,gpt_title:null,
    system_status:'ready',system_strategy:'系统策略',system_product_advice:'系统产品建议',system_strategy_sources:[],system_product_sources:[],
    system_version:2,gpt_strategy:null,gpt_product_advice:null,gpt_strategy_sources:[],gpt_product_sources:[],
    gpt_based_on_system_version:null,gpt_kept_for_system_version:null,gpt_status:'pending',gpt_preview_id:null,
    gpt_preview_payload:null,gpt_preview_actor:null,gpt_preview_expires_at:null,updated_by:'operator',updated_at:stamp,deleted_at:null}));
  const writes=[];
  const fetchImpl=async(url,options={})=>{
    const parsed=new URL(url),method=options.method||'GET',table=parsed.pathname.split('/').pop(),query=parsed.searchParams;
    if(method==='GET') {
      if(table!=='person_followup_advice')return response([]);
      return response(rows.filter(row=>(!query.has('id')||String(row.id)===query.get('id').replace('eq.',''))&&
        (!query.has('person_id')||String(row.person_id)===query.get('person_id').replace('eq.',''))&&
        (!query.has('system_status')||row.system_status===query.get('system_status').replace('eq.',''))&&row.deleted_at===null));
    }
    if(method==='PATCH') {
      const id=Number(query.get('id').replace('eq.','')),row=rows.find(item=>item.id===id);writes.push({id,body:JSON.parse(options.body)});
      if(!row||row.gpt_strategy!==null||row.gpt_product_advice!==null)return response([]);
      Object.assign(row,JSON.parse(options.body));return response([{...row}]);
    }
    throw new Error(`Unexpected method ${method}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{person:{display_name:'测试客户'},recent_interactions:[]}})}});
  const result=await service.run({operation:'gptAdviceDirectSave',data:{rows:[81,82].map((id,index)=>({adviceId:String(id),personId:'42',systemVersion:2,
    gptAdvice:{title:`GPT 标题 ${id}`,overallStrategy:`策略 ${index+1}`,productServiceAdvice:`产品建议 ${index+1}`,
      strategySourceIds:[],productSourceIds:[]}}))}},'operator');
  assert.deepEqual(result.rows.map(item=>[item.adviceId,item.status]),[['81','saved'],['82','saved']]);
  assert.equal(rows[0].gpt_title,'GPT 标题 81');assert.equal(rows[1].gpt_title,'GPT 标题 82');
  assert.deepEqual(writes.map(item=>item.id),[81,82]);
});
