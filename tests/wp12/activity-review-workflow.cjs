'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ActivityReviewWorkflowService}=require('../../cloudfunctions/person_360/activity-review-workflow-service');
const key='11111111-1111-4111-8111-111111111111';

test('activity candidate preview sends only a scoped draft to the service-only command',async()=>{
  const calls=[];
  const service=new ActivityReviewWorkflowService({request:async()=>[],
    rpc:async(name,args)=>{calls.push([name,args]);return {previewId:key,businessDataWritten:false};}});
  const result=await service.preview({idempotencyKey:key,operation:'action',activityId:11,
    resultId:21,candidateIndex:0,draft:{title:'【系统测试·勿联系】核对虚构反馈',
      description:'仅作测试',dueAt:null,priority:'medium'}},'test-uid');
  assert.equal(result.previewId,key);
  assert.equal(calls[0][0],'crm_activity_review_preview_v1');
  assert.deepEqual(calls[0][1].p_payload,{title:'【系统测试·勿联系】核对虚构反馈',
    description:'仅作测试',dueAt:null,priority:'medium'});
  assert.equal(calls[0][1].p_ai_result_id,21);
  assert.equal(calls[0][1].p_actor_uid,'test-uid');
  assert.ok(!Object.hasOwn(calls[0][1],'confirmed'));
});

test('malformed references and Outcome times are rejected before any database call',async()=>{
  let count=0;
  const service=new ActivityReviewWorkflowService({request:async()=>[],
    rpc:async()=>{count++;return {};}});
  await assert.rejects(service.preview({idempotencyKey:key,operation:'action',activityId:11,
    resultId:21,candidateIndex:-1,draft:{}},'test-uid'),/candidate index/);
  await assert.rejects(service.preview({idempotencyKey:key,operation:'outcome',activityId:11,
    draft:{outcomeType:'review',result:'test',occurredAt:null}},'test-uid'),/Outcome time/);
  await assert.rejects(service.execute(key,''),/execution/);
  assert.equal(count,0);
});

test('Outcome preview and execute remain separate authenticated calls',async()=>{
  const calls=[];
  const service=new ActivityReviewWorkflowService({request:async()=>[],
    rpc:async(name,args)=>{calls.push([name,args]);return {businessDataWritten:name.includes('execute')};}});
  await service.preview({idempotencyKey:key,operation:'outcome',activityId:11,
    draft:{outcomeType:'review',result:'【系统测试·勿联系】虚构复盘',
      occurredAt:'2026-10-05T00:00:00+08:00'}},'test-uid');
  await service.execute(key,'test-uid');
  assert.equal(calls.length,2);
  assert.equal(calls[0][1].p_ai_result_id,null);
  assert.equal(calls[0][1].p_payload.occurredAt,'2026-10-04T16:00:00.000Z');
  assert.deepEqual(calls[1],['crm_activity_review_execute_v1',
    {p_actor_uid:'test-uid',p_preview_id:key}]);
});
