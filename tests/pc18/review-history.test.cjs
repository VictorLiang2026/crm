'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ActivityReviewWorkflowService,historyCandidates}=require('../../cloudfunctions/person_360/activity-review-workflow-service');

test('PC18 returns bounded activity-scoped versions, candidate decisions, outcomes, and disclosure',async()=>{
  const calls=[];
  const service=new ActivityReviewWorkflowService({
    request:async(table,method,filters)=>{
      calls.push({table,method,filters});
      if(table==='activities')return [{id:42,name:'【系统测试·勿联系】活动甲',status:'ended'}];
      if(table==='ai_tasks')return [{id:20,task_type:'activity_review',subject_type:'activity',subject_id:'42',status:'completed',created_at:'2026-10-16T01:00:00Z',
        context_snapshot:{_context:{recipe:'activity_review',subjectType:'activity',subjectId:42},
          persons:[{data:{id:9001,display_name:'虚构人物'}}],
          activity_interactions:[{source:{schema:'public',table:'interactions',id:50},
            data:{id:50,person_id:9001,importance:3}}]}}];
      if(table==='ai_results')return [{id:30,task_id:20,rank:1,created_at:'2026-10-16T01:01:00Z',result_json:{
        summary:'【系统测试·勿联系】虚构总结',whoMattered:[{text:'虚构证据',sourceRefs:['public.interactions#50']}],
        actionCandidates:[{personId:9001,personName:'虚构人物',title:'回访',confidence:0.82,sourceRefs:['public.interactions#50']}],
        opportunityCandidates:[]}}];
      if(table==='crm_activity_review_commands')return [{id:'preview-uuid',activity_id:42,ai_result_id:30,
        candidate_index:0,operation:'action',actor_uid:'private-uid',request_hash:'private-hash',
        executed_at:'2026-10-16T02:00:00Z',result_json:{status:'accepted',kind:'action',actionId:71}}];
      if(table==='outcomes')return [{id:81,activity_id:42,outcome_type:'review',result:'【系统测试·勿联系】虚构实际结果',occurred_at:'2026-10-16T03:00:00Z'}];
      throw new Error(`unexpected table ${table}`);
    },
    rpc:async()=>({}),
    disclosure:async refs=>({status:'verified',containsTestData:true,recordCount:2,
      sources:[{batchKey:'crm_test_pc18',table:'persons',count:1}],receivedRefs:refs}),
  });
  const result=await service.history('42');
  assert.equal(result.activity.id,42);
  assert.equal(result.versions.length,1);
  assert.equal(result.versions[0].id,30);
  assert.equal(result.versions[0].actionCandidates[0].confidence,0.82);
  assert.equal(result.versions[0].actionCandidates[0].sourceIndex,0);
  assert.deepEqual(result.versions[0].decisions,[{candidateIndex:0,kind:'action',status:'accepted',
    result:{status:'accepted',kind:'action',actionId:71},executedAt:'2026-10-16T02:00:00Z'}]);
  assert.equal(result.outcomes[0].id,81);
  assert.equal(JSON.stringify(result).includes('private-uid'),false);
  assert.equal(JSON.stringify(result).includes('private-hash'),false);
  const commandCall=calls.find(call=>call.table==='crm_activity_review_commands');
  assert.equal(commandCall.method,'GET');
  assert.equal(commandCall.filters.activity_id,'eq.42');
  assert.equal(commandCall.filters.ai_result_id,'in.(30)');
  assert.equal(commandCall.filters.executed_at,'not.is.null');
  assert.match(calls.find(call=>call.table==='ai_tasks').filters.select,/context_snapshot/);
  assert.ok(result.testData.receivedRefs.some(ref=>ref.table==='interactions'&&ref.id==='50'));
});

test('PC36 E09 filters unsupported pending candidates but retains original indices and decided audit',()=>{
  const snapshot={_context:{recipe:'activity_review',subjectType:'activity',subjectId:11},
    persons:[{data:{id:783,display_name:'【系统测试·勿联系】虚构体验甲'}}],
    activity_interactions:[{source:{schema:'public',table:'interactions',id:11},
      data:{id:11,person_id:783,importance:3}}],
    recent_interactions:[{source:{schema:'public',table:'interactions',id:6},
      data:{id:6,person_id:783,importance:4}}],
    participants:[{source:{schema:'public',table:'activity_participants',id:18},
      data:{id:18,resolved_person_id:783,status:'attended'}}]};
  const candidate=sourceRefs=>({personId:783,title:'【系统测试·勿联系】核查',sourceRefs});
  const review={actionCandidates:[candidate(['public.interactions#6']),
    candidate(['public.interactions#11']),candidate(['public.interactions#6']),
    candidate(['public.activity_participants#18'])],
    opportunityCandidates:[candidate(['public.activity_participants#18']),
      candidate(['public.interactions#11'])]};
  const decisions=[{kind:'action',candidateIndex:2,status:'rejected'}];
  const display=historyCandidates(review,snapshot,11,decisions);
  assert.deepEqual(display.actionCandidates.map(row=>row.sourceIndex),[1,2,3]);
  assert.deepEqual(display.opportunityCandidates.map(row=>row.sourceIndex),[1]);
  assert.equal(display.actionCandidates[0].personName,'【系统测试·勿联系】虚构体验甲');
  assert.deepEqual(review.actionCandidates.map(row=>row.sourceIndex),[undefined,undefined,undefined,undefined],
    'saved AI result must remain unchanged');
  assert.deepEqual(historyCandidates(review,{...snapshot,_context:{...snapshot._context,subjectId:12}},11,decisions)
    .actionCandidates.map(row=>row.sourceIndex),[2],
    'a mismatched snapshot must not authorize pending candidates');
});

test('PC18 rejects an unavailable or malformed activity before reading review history',async()=>{
  let reads=0;
  const service=new ActivityReviewWorkflowService({request:async()=>{reads++;return [];},rpc:async()=>({})});
  await assert.rejects(service.history('0'),/Invalid activity ID/);
  await assert.rejects(service.history('42'),/Activity unavailable/);
  assert.equal(reads,1);
});

test('PC18 preserves an empty review as no supported candidates',async()=>{
  const service=new ActivityReviewWorkflowService({
    request:async table=>table==='activities'?[{id:43,name:'【系统测试·勿联系】无证据活动',status:'ended'}]:
      table==='ai_tasks'?[{id:22,task_type:'activity_review',subject_type:'activity',subject_id:'43',status:'completed'}]:
      table==='ai_results'?[{id:32,task_id:22,result_json:{summary:'证据不足',actionCandidates:[],opportunityCandidates:[]}}]:
      table==='outcomes'?[]:[],
    rpc:async()=>({}),disclosure:async()=>({status:'verified',containsTestData:false,recordCount:0,sources:[]}),
  });
  const result=await service.history(43);
  assert.deepEqual(result.versions[0].actionCandidates,[]);
  assert.deepEqual(result.versions[0].opportunityCandidates,[]);
  assert.deepEqual(result.versions[0].decisions,[]);
});
