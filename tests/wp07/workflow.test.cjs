'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runQuickCaptureV2,createData}=require('../../cloudfunctions/assistant/quick-capture-v2-service');
const uid='test-uid', name='【系统测试·勿联系】虚构体验甲';
const identity={uid,isAnonymous:false};
const draft={interaction:{type:'见面',at:'2026-10-03T12:00:00+08:00',channel:'当面',
  summary:name+'活动回顾',rawNote:name+'活动回顾'},facts:[],signals:[],actions:[],commitments:[]};
const old=process.env.CRM_TEST_SEED_UIDS;process.env.CRM_TEST_SEED_UIDS=uid;
test.after(()=>{if(old===undefined)delete process.env.CRM_TEST_SEED_UIDS;
  else process.env.CRM_TEST_SEED_UIDS=old;});

test('anonymous and non-allowlisted callers cannot touch V2',async()=>{
  let called=0;const data={run:async()=>{called++;},resolve:async()=>{called++;}};
  await assert.rejects(runQuickCaptureV2({action:'quickCaptureV2',stage:'parse',text:name},
    {uid,isAnonymous:true},{data}),{code:'FORBIDDEN'});
  await assert.rejects(runQuickCaptureV2({action:'quickCaptureV2',stage:'execute',
    commandId:'22222222-2222-4222-8222-222222222222'},
    {uid:'another',isAnonymous:false},{data}),{code:'FORBIDDEN'});
  assert.equal(called,0);
});
test('AI parse returns audit IDs and no business write',async()=>{
  let writes=0;const data={run:async()=>{writes++;}};
  const gateway={runAITask:async request=>{
    assert.equal(request.skill,'quick_capture_v2');assert.equal(request.context.actor_uid,uid);
    return {taskId:101,runId:102,resultId:103,result:{person_name:name,
      interaction:{type:'见面',date:'2026-10-03',channel:'当面',summary:name+'沟通'},
      facts:[name+'明确事实'],signals:[],opportunity_candidates:[],action_candidates:[],
      commitment_candidates:[],evidence:[]}};
  }};
  const result=await runQuickCaptureV2({action:'quickCaptureV2',stage:'parse',text:name},
    identity,{data,gateway});
  assert.equal(result.businessDataWritten,false);assert.equal(result.aiTaskId,101);
  assert.equal(result.preview.facts.length,1);assert.equal(writes,0);
});
test('plan rejects same-name ID mismatch and leaves audit to the atomic database plan',async()=>{
  const calls=[];const data={resolve:async()=>({candidates:[{id:'42',displayName:name}]}),
    run:async(...args)=>{calls.push(args);return {ok:true,status:'planned',commandId:'id'};}};
  await assert.rejects(runQuickCaptureV2({action:'quickCaptureV2',stage:'plan',
    personId:43,selectedDisplayName:name,draft,aiTaskId:101,aiResultId:103},
    identity,{data}),{code:'IDENTITY_CHANGED'});
  assert.equal(calls.length,0);
  const result=await runQuickCaptureV2({action:'quickCaptureV2',stage:'plan',
    personId:42,selectedDisplayName:name,draft,aiTaskId:101,aiResultId:103},
    identity,{data});
  assert.equal(result.status,'planned');assert.equal(calls[0][0],'plan');
  assert.equal(calls[0][2].personId,42);
});
test('plan uses the atomic RPC and does not send an audit link before validation',async()=>{
  const paths=[];
  const data=createData({env:'crm-test',key:'fictional-key',fetchImpl:async(url,request)=>{
    paths.push(new URL(url).pathname);
    assert.equal(request.method,'POST');
    return {ok:false,json:async()=>({code:'22023'})};
  }});
  await assert.rejects(data.run('plan',uid,{personId:42,selectedDisplayName:name,
    draft,aiTaskId:101,aiResultId:103}),{code:'INVALID_INPUT'});
  assert.deepEqual(paths,['/v1/rdb/rest/rpc/quick_capture_v2_plan_v1']);
});
test('confirm requires preview hash and execute only forwards same receipt',async()=>{
  const calls=[];const data={run:async(...args)=>{calls.push(args);return {ok:true,
    status:'executed',replayed:true,businessDataWritten:false,resultIds:{interactionId:17}};}};
  const commandId='22222222-2222-4222-8222-222222222222';
  await assert.rejects(runQuickCaptureV2({action:'quickCaptureV2',stage:'confirm',
    commandId,previewHash:'bad',confirmed:true},identity,{data}),{code:'CONFIRMATION_REQUIRED'});
  assert.equal(calls.length,0);
  const result=await runQuickCaptureV2({action:'quickCaptureV2',stage:'execute',
    commandId,confirmed:true},identity,{data});
  assert.equal(result.replayed,true);
  assert.deepEqual(calls[0],['execute',uid,{commandId,previewHash:null}]);
});
