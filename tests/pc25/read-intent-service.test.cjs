'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {runReadIntent,validateIntentResult} = require('../../cloudfunctions/assistant/read-intent-service');
const {createMain} = require('../../cloudfunctions/assistant');

function parsed(intent,status='supported',extra={}) { return {status,intent,interpretation:`${intent} request`,personMention:null,options:[],...extra}; }
function setup(results,{candidates=[{id:'2',displayName:'李明',organization:'A',occupation:'顾问'}]}={}) {
  let n=0; const calls=[];
  const dependencies={app:{callFunction:async x=>{calls.push(['plan',x]);return {result:{view:'morning',sections:{morningBrief:{headline:'Brief'},topActions:[]}}};}},
    database:{auditRdb:{},resolveName:async name=>{calls.push(['resolve',name]);return {status:'choose_or_qualify',candidates};}},
    gateway:{runAITask:async x=>{calls.push(['model',x]);return {result:results[Math.min(n++,results.length-1)],taskId:10+n,resultId:20+n};}},
    search:async x=>{calls.push(['search',x]);return {ok:true,status:'complete',rows:[],total:0};},
    summarize:async x=>{calls.push(['summarize',x]);return {ok:true,personId:x.personId,summary:'Sourced summary',sources:[{schema:'public',table:'persons',id:x.personId}],execution:{businessDataWritten:false}};},
    prepare:async x=>{calls.push(['prepare',x]);return {ok:true,personId:x.personId,brief30Seconds:'Prep',sources:[{schema:'public',table:'interactions',id:'8'}],execution:{businessDataWritten:false}};},
  };
  return {dependencies,calls};
}

test('clarification presents only bounded options and performs no data read',async()=>{
  const {dependencies,calls}=setup([parsed('unsupported','needs_clarification',{options:['search','summarize']})]);
  const result=await runReadIntent({query:'看看李明'},dependencies);
  assert.equal(result.status,'needs_intent_choice'); assert.deepEqual(result.options,['search','summarize']);
  assert.deepEqual(calls.map(x=>x[0]),['model']); assert.equal(result.execution.businessDataWritten,false);
});

test('analysis remains explicitly rejected without fabricating a result',async()=>{
  const {dependencies,calls}=setup([parsed('analyze','unsupported')]);
  const result=await runReadIntent({query:'分析李明的机会'},dependencies);
  assert.equal(result.status,'unsupported'); assert.equal(result.execution.performed,false);
  assert.deepEqual(calls.map(x=>x[0]),['model']);
});

test('summary requires a Person choice and resolves the selected candidate again before execution',async()=>{
  const {dependencies,calls}=setup([parsed('summarize','supported',{personMention:'李明'}),parsed('summarize','supported',{personMention:'李明'})]);
  const first=await runReadIntent({query:'总结李明近期变化'},dependencies);
  assert.equal(first.status,'needs_person_selection'); assert.equal(first.execution.performed,false);
  assert.equal(calls.some(x=>x[0]==='summarize'),false);
  const second=await runReadIntent({query:'总结李明近期变化',selectedPersonId:'2'},dependencies);
  assert.equal(second.status,'complete'); assert.equal(second.execution.businessDataWritten,false);
  assert.equal(calls.filter(x=>x[0]==='resolve').length,2);
  assert.equal(calls.find(x=>x[0]==='summarize')[1].personId,'2');
});

test('forged or stale Person selection is rejected before a read executor runs',async()=>{
  const {dependencies,calls}=setup([parsed('prepare','supported',{personMention:'李明'})]);
  await assert.rejects(runReadIntent({query:'准备与李明会面',selectedPersonId:'999'},dependencies),{code:'INVALID_INPUT'});
  assert.equal(calls.some(x=>x[0]==='prepare'),false);
});

test('a search delegates to PC24 and preserves its source result and read-only flags',async()=>{
  const {dependencies,calls}=setup([parsed('search')]);
  const result=await runReadIntent({query:'找最近参加活动的人'},dependencies);
  assert.equal(result.status,'complete'); assert.equal(result.intent,'search');
  assert.equal(result.execution.businessDataRead,true); assert.equal(result.execution.businessDataWritten,false);
  assert.equal(calls.find(x=>x[0]==='search')[1].query,'找最近参加活动的人');
});

test('meeting prep uses the existing service only after identity selection',async()=>{
  const {dependencies,calls}=setup([parsed('prepare','supported',{personMention:'李明'})]);
  const result=await runReadIntent({query:'准备与李明会面',selectedPersonId:'2'},dependencies);
  assert.equal(result.status,'complete'); assert.equal(calls.find(x=>x[0]==='prepare')[1].personId,'2');
});

test('today plan delegates to existing Morning Brief and rejects extra Person IDs',async()=>{
  const {dependencies,calls}=setup([parsed('plan')]);
  const result=await runReadIntent({query:'今天的计划'},dependencies);
  assert.equal(result.status,'complete'); assert.equal(result.intent,'plan');
  assert.equal(result.result.view,'morning'); assert.equal(calls.find(x=>x[0]==='plan')[1].name,'today_coach');
  const other=setup([parsed('plan')]);
  await assert.rejects(runReadIntent({query:'今天的计划',selectedPersonId:'2'},other.dependencies),{code:'INVALID_INPUT'});
});

test('invalid gateway schemas, malformed upstream data and timeouts fail instead of empty success',async()=>{
  assert.throws(()=>validateIntentResult({status:'supported',intent:'search',interpretation:'ok',personMention:'123',options:[]}),{code:'INVALID_RESULT'});
  const malformed=setup([parsed('search')]); malformed.dependencies.search=async()=>({ok:true,status:'complete',rows:null});
  await assert.rejects(runReadIntent({query:'搜索'},malformed.dependencies),{code:'INVALID_RESULT'});
  const timeout=setup([parsed('search')]); timeout.dependencies.gateway.runAITask=async()=>{const e=new Error('timeout');e.code='TIMEOUT';throw e;};
  await assert.rejects(runReadIntent({query:'搜索'},timeout.dependencies),{code:'TIMEOUT'});
});

test('new action keeps the real-login gate and leaves legacy route/search contracts intact',async()=>{
  let reads=0,legacy=0;
  const anonymous=createMain(()=>({uid:'anon',isAnonymous:true}),async()=>{legacy++;return {ok:true};},undefined,undefined,async()=>{reads++;return {ok:true};});
  assert.equal((await anonymous({action:'assistantReadTask',query:'today plan'})).error.code,'UNAUTHORIZED');
  assert.equal(reads,0);
  const authenticated=createMain(()=>({uid:'user',isAnonymous:false}),async()=>{legacy++;return {ok:true,legacy:true};},undefined,undefined,async event=>{reads++;return {ok:true,query:event.query};});
  assert.deepEqual(await authenticated({action:'assistantReadTask',query:'today plan'}),{ok:true,query:'today plan'});
  assert.deepEqual(await authenticated({action:'search',query:'old query'}),{ok:true,legacy:true});
  const routed=await authenticated({intent:'prepare',subject:{type:'person',id:'7'},input:{objective:'review'}});
  assert.equal(routed.status,'routed'); assert.equal(routed.execution.performed,false);
  assert.equal(reads,1); assert.equal(legacy,1);
});
