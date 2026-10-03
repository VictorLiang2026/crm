'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./today-timeout.test.cjs');
const {runScenario,createScenarioData,NAME}=require('../../cloudfunctions/assistant/test-scenario-service');
const uid='crm_test_actor',id='00000000-0000-4000-8000-000000000003',hash='a'.repeat(32);
function fixture(ready=false){const calls=[];return {calls,run:async(stage,actor,previewId,previewHash)=>{
 calls.push({stage,actor,previewId,previewHash});return {ok:true,ready,targets:{personId:'91'}};
},resolve:async()=>({status:ready?'confirm_existing':'available',hasMore:false,candidates:ready?[{id:'91'}]:[]})};}
const identity={uid,isAnonymous:false};
test('read-only acceptance honors the existing UI lock before accessing the SDK',async()=>{
 const vm=require('node:vm'),{probe}=require('./readonly-live.cjs');
 for(const locked of [true,false]){
  let sdkCalls=0;
  const context={Date,localStorage:{getItem:()=>String(Date.now()-(locked?0:300001))},
   document:{querySelector:()=>locked?{offsetParent:{}}:null},cloudbase:{init:()=>{sdkCalls++;throw Error('must not start')}}};
  const r=await vm.runInNewContext('('+probe.toString()+')([])',context);
  assert.equal(r.checks[0].status,'MANUAL_LOGIN');assert.equal(sdkCalls,0);
 }
});
test('read-only acceptance issues HEAD checks and only malformed seed requests',async()=>{
 const vm=require('node:vm'),{probe}=require('./readonly-live.cjs'),requests=[],calls=[];
 const token='header.'+Buffer.from(JSON.stringify({role:'authenticated',exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.fixture';
 const state={ok:true,ready:true,initialCount:10,derivedCount:2,auditCount:3,targets:{personId:'91',customerId:'92',activityId:'93'}};
 const context={Date,AbortSignal,localStorage:{getItem:()=>String(Date.now())},document:{querySelector:()=>null},
  atob:s=>Buffer.from(s,'base64').toString(),fetch:async(url,init)=>{requests.push({url,init});return {status:403}},
  cloudbase:{init:()=>({auth:()=>({getSession:async()=>({data:{session:{access_token:token}}})}),callFunction:async({name,data})=>{
   calls.push({name,data});return {result:data.stage==='status'?state:data.stage==='dryRun'?{ok:false,error:{code:'SEED_INVALID_REQUEST'}}:
    data.stage==='execute'?{ok:false,error:{code:'CONFIRMATION_REQUIRED'}}:{testData:{status:'verified',containsTestData:true,sources:[{batchKey:'crm_test_main_v1'}]}}};
  }})}};
 const r=await vm.runInNewContext('('+probe.toString()+')(["persons","crm_test_records"])',context);
 assert.ok(r.checks.every(c=>c.status==='PASS'));assert.equal(requests.length,2);
 assert.ok(requests.every(r=>r.init.method==='HEAD'&&r.init.headers['Accept-Profile']==='public'));
 assert.equal(calls.filter(c=>c.data.stage==='dryRun').length,4);
 assert.ok(calls.filter(c=>c.data.stage==='dryRun').every(c=>Object.keys(c.data).length===3));
 assert.equal(calls.find(c=>c.data.stage==='execute').data.previewId,'invalid');
 assert.ok(!calls.some(c=>c.data.stage==='confirm'||c.data.action==='generate'));
 assert.ok(!JSON.stringify(r).includes(token));
});
test('public assistant entry rejects caller-supplied seed counts and identities before database access',async()=>{
 const {createMain}=require('../../cloudfunctions/assistant');
 const prior=process.env.CRM_TEST_SEED_UIDS;
 process.env.CRM_TEST_SEED_UIDS=uid;
 try {
  const main=createMain(async()=>identity);
  for(const extra of [{count:11},{counts:{persons:11}},{personId:'91'},{customerId:'92'},{batchKey:'crm_test_spoof'},{rows:[]}]) {
   const result=await main({action:'testSamples',stage:'dryRun',...extra});
   assert.equal(result.ok,false);assert.equal(result.error.code,'SEED_INVALID_REQUEST');
  }
 }finally{if(prior===undefined)delete process.env.CRM_TEST_SEED_UIDS;else process.env.CRM_TEST_SEED_UIDS=prior;}
});
test('anonymous and non-allowlisted users cannot even reach the scenario database',async()=>{
 for(const who of [null,{uid,isAnonymous:true},{uid:'other',isAnonymous:false}]){
  const data=fixture();await assert.rejects(runScenario({stage:'dryRun'},who,{allowedUids:[uid],data}),/SEED_FORBIDDEN/);assert.equal(data.calls.length,0);
 }
});
test('client confirmed, plan, counts and extra IDs cannot substitute for verified previews',async()=>{
 for(const extra of [{confirmed:true},{plan:[]},{count:0},{personId:'91'},{batchKey:'crm_test_spoof'}]){
  const data=fixture();await assert.rejects(runScenario({stage:'execute',previewId:id,...extra},identity,{allowedUids:[uid],data}),/SEED_INVALID_REQUEST/);assert.equal(data.calls.length,0);
 }
});
test('fixed fictional name is resolved before a new or replayed dry-run',async()=>{
 for(const ready of [false,true]){const data=fixture(ready);const r=await runScenario({stage:'dryRun'},identity,{allowedUids:[uid],data});
  assert.deepEqual(data.calls.map(x=>x.stage),['status','dryRun']);assert.equal(r.identity.name,NAME);assert.equal(r.identity.requiresHumanConfirmation,true);
 }
});
test('same-name ordinary identity and ambiguous identity are refused, never adopted',async()=>{
 for(const resolution of [{status:'confirm_existing',hasMore:false,candidates:[{id:'99'}]},{status:'choose_or_qualify',hasMore:true,candidates:[]}]){
  const data=fixture(true);data.resolve=async()=>resolution;
  await assert.rejects(runScenario({stage:'dryRun'},identity,{allowedUids:[uid],data}),/SEED_IDENTITY_CONFLICT/);
  assert.equal(data.calls.length,1);
 }
});
test('confirm requires receipt and hash; execute does not accept a hash or boolean',async()=>{
 const data=fixture();
 await assert.rejects(runScenario({stage:'confirm',previewId:id},identity,{allowedUids:[uid],data}),/CONFIRMATION_REQUIRED/);
 await runScenario({stage:'confirm',previewId:id,previewHash:hash},identity,{allowedUids:[uid],data});
 assert.equal(data.calls[0].actor,uid);assert.equal(data.calls[0].previewHash,hash);
 await assert.rejects(runScenario({stage:'execute',previewId:id,previewHash:hash},identity,{allowedUids:[uid],data}),/SEED_INVALID_REQUEST/);
});
test('database RPC stays public and service credential never enters result',async()=>{
 const calls=[];const data=createScenarioData({env:'crm-fixture',key:'fictional-server-key',fetchImpl:async(url,init)=>{
  calls.push({url:String(url),init});return {ok:true,json:async()=>({ok:true,ready:false})};
 }});
 const response=await data.run('status',uid);assert.deepEqual(response,{ok:true,ready:false});
 assert.match(calls[0].url,/\/rpc\/crm_test_scenario_v1$/);assert.equal(calls[0].init.headers['Content-Profile'],'public');
 assert.equal(JSON.parse(calls[0].init.body).p_actor_uid,uid);
});
test('permission and stale preview database failures are explicit',async()=>{
 for(const [code,message]of [['42501','CONFIRMATION_REQUIRED'],['40001','PREVIEW_STALE'],['23514','SEED_CONFLICT']]){
  const data=createScenarioData({env:'crm-fixture',key:'fixture',fetchImpl:async()=>({ok:false,json:async()=>({code:'DATABASE_'+code,message:'private detail'})})});
  await assert.rejects(data.run('execute',uid,id),new RegExp(message));
 }
});
test('ordinary AI Search links its actual task to returned test evidence',async()=>{
 const {runSearch}=require('../../cloudfunctions/assistant/search-service');const links=[];
 const data={search:async()=>({rows:[{person_id:91,activity_id:92,participant_id:93}],total:1,coverage:{rows:1}}),
  testDataReader:async()=>({status:'verified',containsTestData:true,recordCount:1,sources:[]}),linkTestAudit:async(...args)=>links.push(args)};
 const result=await runSearch({query:'最近三个月参加过活动但没有继续跟进的人'},{app:{},data,
  gateway:{runAITask:async()=>({taskId:94,resultId:95,result:{template:'activity_no_followup',months:3}})}});
 assert.equal(result.total,1);assert.equal(links[0][0],94);assert.ok(links[0][1].some(r=>r.table==='persons'&&r.id==='91'));
 delete data.linkTestAudit;
 await assert.rejects(runSearch({query:'虚构查询'},{app:{},data,gateway:{runAITask:async()=>({taskId:94,result:{template:'activity_no_followup',months:3}})}}),/tracking is unavailable/);
});
