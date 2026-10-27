'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveAITask}=require('../../crm/js/modules/console/ai-task-polling.mjs');

test('AI task polling returns completed data and keeps direct legacy responses compatible',async()=>{
  const calls=[];let checks=0;
  const result=await resolveAITask(async()=>({ok:true,status:'pending',taskId:'44'}),async args=>{
    calls.push(args);checks++;
    return checks===1?{ok:true,status:'pending',taskId:'44'}:{ok:true,status:'completed',taskId:'44',summary:'done'};
  },'person_summary','783',{intervalMs:0,timeoutMs:100});
  assert.equal(result.summary,'done');
  assert.deepEqual(calls,[{taskId:'44',personId:'783',taskType:'person_summary'},
    {taskId:'44',personId:'783',taskType:'person_summary'}]);
  assert.deepEqual(await resolveAITask(async()=>({ok:true,summary:'legacy'}),async()=>{throw Error('must not poll');},
    'person_summary','783'),{ok:true,summary:'legacy'});
});

test('AI task polling surfaces failed and expired work with stable codes',async()=>{
  await assert.rejects(resolveAITask(async()=>({ok:true,status:'pending',taskId:'45'}),
    async()=>({ok:false,status:'failed',error:{code:'AI_REQUEST_FAILED'}}),'customer_followup_dual','783',
    {intervalMs:0,timeoutMs:100}),error=>error.code==='AI_REQUEST_FAILED');
  await assert.rejects(resolveAITask(async()=>({ok:true,status:'pending',taskId:'46'}),async()=>{
    await new Promise(resolve=>setTimeout(resolve,2));return {ok:true,status:'pending',taskId:'46'};
  },'customer_followup_dual','783',{intervalMs:0,timeoutMs:1}),error=>error.code==='AI_TASK_TIMEOUT');
});
