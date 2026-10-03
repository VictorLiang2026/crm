'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { waitForTodayAi } = require('../../cloudfunctions/today_coach/ai-wait');
const tick = () => new Promise(resolve => setImmediate(resolve));
function timerClock(now = 0) {
  const timers = [], cleared = [];
  return { timers, cleared, now:()=>now, schedule:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},cancel:t=>cleared.push(t) };
}
test('Today AI wait preserves successful values and original rejection, clearing timers',async()=>{
  const clock=timerClock(), value={text:'【系统测试·勿联系】'};
  assert.equal(await waitForTodayAi(()=>value,0,clock),value);
  const error=Error('fixture rejection');
  await assert.rejects(waitForTodayAi(()=>Promise.reject(error),0,clock),e=>e===error);
  assert.deepEqual(clock.timers.map(t=>t.ms),[40000,40000]);
  assert.deepEqual(clock.cleared,clock.timers);
});
test('Today reserves return time and skips AI when data consumed the budget',async()=>{
  const clock=timerClock(45000);
  assert.equal(await waitForTodayAi(()=>1,0,clock),1);
  assert.equal(clock.timers[0].ms,5000);
  let calls=0;
  await assert.rejects(waitForTodayAi(()=>++calls,0,timerClock(50000)),/TODAY_AI_TIMEOUT/);
  assert.equal(calls,0);
});
test('Today timeout settles despite a stuck SDK; late rejection is handled',async()=>{
  const clock=timerClock();let lateReject;
  const pending=waitForTodayAi(()=>new Promise((_,reject)=>{lateReject=reject;}),0,clock);
  const rejected=assert.rejects(pending,/TODAY_AI_TIMEOUT/);
  await tick();clock.timers[0].fn();await rejected;
  lateReject(Error('late fixture error'));await tick();
  assert.deepEqual(clock.cleared,clock.timers);
});

function loadToday(ai,empty=false) {
  const directory=path.resolve(__dirname,'../../cloudfunctions/today_coach');
  const exports={}, clock=timerClock(Date.now()), calls=[];
  const marker='【系统测试·勿联系】';
  const data={customers:empty?[]:[{Id:91,customer_name:marker+'虚构甲'}],
    v_action_center:empty?[]:[{action_id:'followup-92',action_type:'followup_customer',person_type:'customer',person_id:91,
      person_name:marker+'虚构甲',title:marker+'核对',next_action:marker+'核对',status:'today',days_until:0,
      action_date:'2026-10-03',priority:'A',source:'followups'}]};
  const rdb={from(table){
    const q={select:()=>q,is:()=>q,order:()=>q,then:resolve=>Promise.resolve({data:data[table]||[]}).then(resolve)};
    for(const op of ['insert','update','delete','upsert'])q[op]=()=>{throw Error('WRITE_FORBIDDEN')};return q;
  }};
  const disclosure={status:'verified',containsTestData:!empty,recordCount:empty?0:1,
    sources:empty?[]:[{batchKey:'crm_test_timeout',table:'customers',count:1}]};
  const db={app:{auth:()=>({getUserInfo:()=>({uid:'crm_test_actor',isAnonymous:false})})},rdb,
    generateText:async(...args)=>{calls.push(args);return ai(...args);},extractJson:JSON.parse,
    nowIso:()=>new Date().toISOString(),assertOk:x=>x};
  const TD=require('../../cloudfunctions/today_coach/test-data');
  const context={exports,process:{env:{}},console,Date,Buffer,Map,Set,setTimeout,clearTimeout,
    require(name){
      if(name==='./db')return db;
      if(name==='./test-data')return {...TD,disclose:async()=>disclosure};
      if(name==='./action-facts')return {...require(path.join(directory,name)),readOpenActions:async()=>({rows:[],persons:[]})};
      if(name==='./ai-wait')return {waitForTodayAi:(work,start)=>waitForTodayAi(work,start,clock)};
      return require(name.startsWith('./')?path.join(directory,name):name);
    }};
  vm.runInNewContext(fs.readFileSync(path.join(directory,'index.js'),'utf8'),context);
  return {main:exports.main,clock,calls,disclosure};
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('real Today handler returns the same rule facts on AI rejection and deadline',async()=>{
  const failed=loadToday(()=>{throw Error('fixture');});
  const expected=plain(await failed.main({action:'generate'}));
  let lateResolve;
  const stuck=loadToday(()=>new Promise(resolve=>{lateResolve=resolve;}));
  const pending=stuck.main({action:'generate'});await tick();
  assert.equal(stuck.clock.timers.length,1);stuck.clock.timers[0].fn();
  const result=plain(await pending);
  assert.equal(result.error,undefined);assert.equal(result.source,'rule');
  assert.equal(result.today5.length,1);assert.match(result.ai_error,/TODAY_AI_TIMEOUT/);
  for(const key of ['today5','items','all_actions','all_actions_total','quota','testData'])assert.deepEqual(result[key],expected[key]);
  assert.equal(result.testData.containsTestData,true);
  assert.match(JSON.stringify(stuck.calls[0][0]),/含测试数据/);
  lateResolve({text:'{"picks":[]}'});await tick();assert.equal(result.source,'rule');
});
test('real Today handler keeps successful AI annotations and existing candidate facts',async()=>{
  const f=loadToday(()=>({text:JSON.stringify({picks:[{ref:1,tier:'must_do',reason:'【系统测试·勿联系】排序说明',channel:'微信',script:'【系统测试·勿联系】虚构话术'}]})}));
  const r=await f.main({action:'generate'});
  assert.equal(r.error,undefined);assert.equal(r.source,'ai');assert.equal(r.today5.length,1);
  assert.equal(r.today5[0].action_id,'followup-92');assert.equal(r.testData.containsTestData,true);
  assert.deepEqual(f.clock.cleared,f.clock.timers);
});
test('empty Today and ordinary read branches do not start an AI wait',async()=>{
  const f=loadToday(()=>{throw Error('AI must not run');},true);
  const r=await f.main({action:'generate'});assert.equal(r.error,undefined);assert.equal(r.today5.length,0);
  assert.equal((await f.main({action:'candidates'})).error,undefined);
  assert.equal((await f.main({action:'cockpit'})).error,undefined);
  assert.equal(f.calls.length,0);assert.equal(f.clock.timers.length,0);
});
