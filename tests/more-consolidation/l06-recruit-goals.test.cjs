'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
async function calculator(){return import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(root,'crm/js/modules/console/recruit-goal-draft.js'))).toString('base64'));}
test('L06 previous month, complete draft, zero, rounding and extreme inputs',async()=>{
 const c=await calculator(),s=c.GOAL_STAGES;
 assert.equal(c.previousGoalMonth('2027-01'),'2026-12');assert.equal(c.previousGoalMonth('2026-10'),'2026-09');
 for(const month of ['2026-00','2026-13','2026-1','bad'])assert.throws(()=>c.previousGoalMonth(month));
 const rates=s.slice(0,-1).map((stage,i)=>({stage_from:stage,stage_to:s[i+1],conversion_avg:50}));
 assert.deepEqual(Object.values(c.reverseGoalDraft(2,rates)),[128,64,32,16,8,4,2]);
 assert.deepEqual(Object.values(c.reverseGoalDraft(0,rates)),[0,0,0,0,0,0,0]);
 assert.equal(c.reverseGoalDraft(1,rates.map(r=>({...r,conversion_avg:33})))[s[5]],4);
 for(const value of [-1,1.5,Infinity,NaN,2147483648,true,[]])assert.throws(()=>c.reverseGoalDraft(value,rates));
 for(const rate of [0,-1,101,NaN,Infinity,0.000001])assert.throws(()=>c.reverseGoalDraft(1,rates.map(r=>({...r,conversion_avg:rate}))));
 assert.throws(()=>c.reverseGoalDraft(1,rates.slice(1)));
 assert.throws(()=>c.goalDraftFromRows([]));
 assert.throws(()=>c.goalDraftFromRows([{stage:s[0],target_count:1},{stage:s[0],target_count:2}]));
 assert.equal(c.goalDraftFromRows([{stage:s[0],target_count:8}])[s[0]],8);
 assert.equal(c.goalDraftFromRows([{stage:s[0],target_count:8}])[s[6]],0);
});
function service(response={data:{ok:true,updated:2}}){
 const calls=[],source=fs.readFileSync(path.join(root,'cloudfunctions/recruit_goals/index.js'),'utf8'),module={exports:{}};
 const rdb={rpc:async(name,params)=>{calls.push({name,params});return response;},from:table=>{
  calls.push({table});const query={update(payload){calls.push({payload});return query;},eq(){return query;},select(){return Promise.resolve({data:[{id:1}]});}};return query;
 }};
 vm.runInNewContext(source,{module,exports:module.exports,require:name=>{
  if(name==='./test-data')return{};
  if(name==='./db')return{rdb,nowIso:()=>new Date().toISOString(),normFields:()=>({}),assertOk:r=>{if(r.error)throw Error(r.error.message);return r;}};
  throw Error('Unexpected dependency');
 }});
 return{calls,invoke:event=>module.exports.main(event,{})};
}
const assumption=()=>({stage_from:'新增人才',stage_to:'互动暖客',conversion_min:10,conversion_avg:20,conversion_good:30,updated_at:'2026-10-25T00:00:00.123456+00:00',source:'[CRM_TEST_ONLY] personal assumption'});
test('L06 atomic assumption save uses one versioned RPC and keeps source/version',async()=>{
 const svc=service(),row=assumption(),r=await svc.invoke({action:'saveBenchmarks',atomic:true,benchmarks:[row]});
 assert.equal(r.ok,true);assert.equal(svc.calls.length,1);assert.equal(svc.calls[0].name,'crm_recruit_benchmarks_save_v1');
 assert.deepEqual(JSON.parse(JSON.stringify(svc.calls[0].params.p_rows)),[row]);
});
test('L06 validates the entire batch before any RPC and refuses invalid atomic modes',async()=>{
 const invalid=[null,[],Array(8).fill(assumption()),[assumption(),assumption()]];
 for(const change of [{conversion_min:0},{conversion_avg:-1},{conversion_good:101},{conversion_avg:5},{conversion_good:15},{conversion_avg:'20'},{conversion_avg:Infinity},{updated_at:'bad'},{stage_to:'任意阶段'},{stage_from:['互动暖客']},{stage_to:['初次面谈']},{source:'x'.repeat(501)},{source:null},{unknown:true}]){
  invalid.push([assumption(),{...assumption(),stage_from:'互动暖客',stage_to:'初次面谈',...change}]);
 }
 for(const benchmarks of invalid){const svc=service();assert.ok((await svc.invoke({action:'saveBenchmarks',atomic:true,benchmarks})).error);assert.equal(svc.calls.length,0);}
 for(const atomic of ['true',1,null]){const svc=service();assert.ok((await svc.invoke({action:'saveBenchmarks',atomic,benchmarks:[assumption()]})).error);assert.equal(svc.calls.length,0);}
});
test('L06 transaction failure has no partial-save fallback; old benchmark request still uses original update',async()=>{
 const svc=service({error:{message:'Assumption changed; reload before saving'}});
 const result=await svc.invoke({action:'saveBenchmarks',atomic:true,benchmarks:[assumption()]});
 assert.match(result.error,/changed/);assert.equal(svc.calls.length,1);
 const legacy=service();const old=await legacy.invoke({action:'saveBenchmarks',benchmarks:[{stage_from:'新增人才',stage_to:'互动暖客',conversion_avg:'bad'}]});
 assert.equal(old.ok,true);assert.equal(legacy.calls[0].table,'recruit_goal_benchmarks');
 assert.equal(legacy.calls[1].payload.conversion_avg,0);
});
