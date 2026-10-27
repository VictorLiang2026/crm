'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAIGateway}=require('../../cloudfunctions/assistant/ai-gateway');

test('Assistant Gateway exposes the claimed task after audit setup and before the model call',async()=>{
  const events=[];let modelCalls=0;
  const store={
    async createTask(){return '71';},async updateTask(){},
    async claimTask(){return {status:'claimed',taskId:'71'};},
    async createRun(){return '72';},async updateRun(){},async createResult(){return '73';},
    async finishAttempt(){return {status:'completed',taskId:'71',runId:'72',resultId:'73'};},
  };
  const gateway=createAIGateway({app:{ai:()=>({createModel:()=>({generateText:async()=>{
    modelCalls++;return {text:'{"summary":"safe"}',usage:{}};
  }})})},store,timeoutMs:1000,maxAttempts:1,modelResolver:()=> 'configured-model',
  skillRegistry:{get:()=>({name:'person_summary',version:'1.0.0',capability:'summarization',timeoutClass:'standard',
    outputSchema:{type:'object'}}),validateInput:()=>true,validateContext:()=>true,validateOutput:()=>true},
  actorResolver:async()=>({uid:'test-operator',isAnonymous:false})});
  await gateway.runAITask({taskType:'person_summary',skill:'person_summary',capability:'summarization',
    input:{personId:'783'},context:{},contextSnapshot:{_context:{recipe:'person_summary',version:'1.0.0'}},
    onStarted:async value=>events.push({...value,modelCalls})});
  assert.deepEqual(events,[{taskId:'71',runId:'72',modelCalls:0}]);
  assert.equal(modelCalls,1);
});
