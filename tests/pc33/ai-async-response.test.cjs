'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMain}=require('../../cloudfunctions/assistant/index');

function mainWithSummary(summaryRunner){
  return createMain(()=>({uid:'test-operator',isAnonymous:false}),...Array(12).fill(undefined),summaryRunner,
    undefined,async()=>({ok:true,status:'pending'}));
}

function mainWithKnowledgeLibrary(libraryRunner){
  return createMain(()=>({uid:'test-operator',isAnonymous:false}),...Array(12).fill(undefined),undefined,
    libraryRunner,async()=>({ok:true,status:'pending'}));
}

test('AI summary sends a pending task ID before generation completes and keeps the invocation alive',async()=>{
  let finish,markComplete;let reachedModel=false;
  const completed=new Promise(resolve=>{markComplete=resolve;});
  const summaryRunner=async(event,{onStarted})=>{
    await onStarted({taskId:71});
    reachedModel=true;
    await new Promise(resolve=>{finish=resolve;});
    markComplete();
    return {ok:true,taskId:71,summary:'completed'};
  };
  const main=mainWithSummary(summaryRunner),callbacks=[],context={};
  const invocation=main({action:'summarize',personId:'783',asyncWait:true},context,(error,result)=>callbacks.push({error,result,
    callbackWaitsForEmptyEventLoop:context.callbackWaitsForEmptyEventLoop}));
  assert.equal(invocation,undefined);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reachedModel,true);
  assert.equal(callbacks.length,1);
  assert.equal(callbacks[0].error,null);
  assert.equal(callbacks[0].callbackWaitsForEmptyEventLoop,false);
  assert.deepEqual(callbacks[0].result,{ok:true,status:'pending',taskId:'71',personId:'783'});
  finish();
  await completed;
});

test('AI summary preserves synchronous response for older callers',async()=>{
  const main=mainWithSummary(async()=>({ok:true,taskId:72,summary:'legacy'}));
  assert.deepEqual(await main({action:'summarize',personId:'783'}),{ok:true,taskId:72,summary:'legacy'});
});

test('async callback mode returns a completed reused result when no new task starts',async()=>{
  const main=mainWithSummary(async()=>({ok:true,taskId:72,resultId:95,summary:'reused'}));
  const callbacks=[],context={};
  assert.equal(main({action:'summarize',personId:'783',asyncWait:true},context,
    (error,result)=>callbacks.push({error,result,callbackWaitsForEmptyEventLoop:context.callbackWaitsForEmptyEventLoop})),undefined);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(callbacks,[{error:null,result:{ok:true,taskId:72,resultId:95,summary:'reused'},callbackWaitsForEmptyEventLoop:false}]);
});

test('dual recommendations send a pending task ID and preserve background completion',async()=>{
  let finish,markComplete;let modelReached=false;
  const completed=new Promise(resolve=>{markComplete=resolve;});
  const libraryRunner=async(event,actor,{onStarted})=>{
    await onStarted({taskId:73});modelReached=true;
    await new Promise(resolve=>{finish=resolve;});
    markComplete();
    return {ok:true,taskId:73,candidates:[]};
  };
  const main=mainWithKnowledgeLibrary(libraryRunner),callbacks=[],context={};
  const invocation=main({action:'knowledgeLibrary',operation:'dualGenerate',data:{personId:'783',asyncWait:true}}, context,
    (error,result)=>callbacks.push({error,result,callbackWaitsForEmptyEventLoop:context.callbackWaitsForEmptyEventLoop}));
  assert.equal(invocation,undefined);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(modelReached,true);assert.equal(callbacks.length,1);assert.equal(callbacks[0].error,null);
  assert.equal(callbacks[0].callbackWaitsForEmptyEventLoop,false);
  assert.deepEqual(callbacks[0].result,{ok:true,status:'pending',taskId:'73',personId:'783'});
  finish();await completed;
});

test('AI task status route authenticates first and only accepts supported task types',async()=>{
  let calls=0,seen;
  const main=createMain(()=>({uid:'test-operator',isAnonymous:false}),...Array(12).fill(undefined),undefined,
    undefined,async input=>{calls++;seen=input;return {ok:true,status:'pending',taskId:input.taskId};});
  const response=await main({action:'aiTaskStatus',personId:'783',taskType:'customer_followup_dual',startedAt:'2026-10-30T00:00:00.000Z'});
  assert.equal(response.status,'pending');assert.equal(calls,1);
  assert.equal(seen.startedAt,'2026-10-30T00:00:00.000Z');
  const invalid=await main({action:'aiTaskStatus',taskId:'9',personId:'783',taskType:'other'});
  assert.equal(invalid.error.code,'INVALID_INPUT');assert.equal(calls,1);
  const anonymous=createMain(()=>({uid:'anon',isAnonymous:true}),...Array(12).fill(undefined));
  assert.equal((await anonymous({action:'aiTaskStatus',taskId:'9',personId:'783',taskType:'person_summary'})).error.code,'UNAUTHORIZED');
});
