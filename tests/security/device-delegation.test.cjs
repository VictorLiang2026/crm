'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const sql=name=>fs.readFileSync(path.join(root,'cloudbase/migrations',name+'.sql'),'utf8');
const rollback=name=>fs.readFileSync(path.join(root,'cloudbase/migrations',name+'.rollback.sql'),'utf8');

test('device schema migrations have guarded public-only rollbacks',()=>{
 for(const name of ['20261110153000_device_delegation','20261110153100_device_file_parts']){
  assert.ok(fs.existsSync(path.join(root,'cloudbase/migrations',name+'.rollback.sql')));
  const source=sql(name),down=rollback(name);
  assert.match(source,/\bpublic\./);
  assert.match(down,/\bpublic\./);
  assert.match(down,/RAISE EXCEPTION/);
  assert.doesNotMatch(down,/DROP\s+(?:TABLE|FUNCTION).*?\bCASCADE\b|(?:\bpr\.|\bpr_[a-z0-9_]+)/is);
 }
});

test('device gate migration grants narrowly scoped service reads and execution',()=>{
 const migration=sql('20261110193000_device_delegation_gate_policies');
 assert.match(migration,/GRANT SELECT ON public\.crm_device_delegations,public\.crm_device_file_parts,public\.crm_device_file_uploads TO service_role/);
 for(const table of ['crm_device_delegations','crm_device_file_parts','crm_device_file_uploads'])
  assert.match(migration,new RegExp('CREATE POLICY '+table+'_service_select ON public\\.'+table+' FOR SELECT TO service_role USING \\(true\\)'));
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.crm_device_delegate_v1\(text,jsonb\) TO service_role/);
 assert.doesNotMatch(migration,/(?:\bpr\.|\bpr_[a-z0-9_]+)/i);
});

test('hardening migration limits all delegation RPC operations to service_role',()=>{
 const migration=sql('20261110195000_device_delegation_service_role');
 assert.match(migration,/caller_role IS DISTINCT FROM 'service_role'/);
 assert.match(migration,/REVOKE ALL ON FUNCTION public\.crm_device_delegate_v1\(text,jsonb\) FROM PUBLIC,anon,authenticated/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.crm_device_delegate_v1\(text,jsonb\) TO service_role/);
 assert.doesNotMatch(migration,/GRANT EXECUTE ON FUNCTION public\.crm_device_delegate_v1\(text,jsonb\) TO anon/);
 assert.doesNotMatch(migration,/(?:\bpr\.|\bpr_[a-z0-9_]+)/i);
});

test('customers matches the deployed device-protected entry and rejects unsigned calls',async()=>{
 const runtime=require('../../cloudfunctions/customers/device-runtime');
 const actor='customer-device-member';let dispatched=0;
 const app={auth:()=>({getUserInfo:()=>({uid:actor,isAnonymous:false})}),
  callFunction:async request=>{
   assert.equal(request.name,'person_360');
   assert.equal(request.data.action,'verifyBusinessDeviceOnly');
   assert.equal(request.data.audience,'customers');
   return {result:{verified:true,actor}};
  }};
 const handler=runtime.protect('customers',async event=>{
  dispatched++;return {action:event.action,actor:runtime.callerIdentity(app).uid};
 },()=>app);
 assert.deepEqual(await handler({__deviceRequest:{action:'list',__deviceProof:{fingerprint:'a'.repeat(64),challenge:crypto.randomUUID(),signature:'test'}}}),
  {action:'list',actor});
 assert.equal(dispatched,1);
 assert.deepEqual(await handler({action:'list'}),{ok:false,error:'DEVICE_ACCESS_DENIED'});
 assert.equal(dispatched,1);
});

test('deployed CRM device-protected entrypoints and runtime helpers are present in source',()=>{
 const names=['activities','activity_reports','activity_speakers','activity_tasks','activity_topics','ai_activity','ai_followup',
  'ai_recommend','ai_recommendations','ai_referral','assistant','customers','followups','funnel_insight','gifts',
  'opportunities','ocr_records','person_360','photos','pmc18_observer','policy_review_reports','products','recruit_candidates',
  'recruit_followups','recruit_goals','recruit_recommend','recruit_score'];
 for(const name of names){
  const source=fs.readFileSync(path.join(root,'cloudfunctions',name,'index.js'),'utf8');
  if(name==='assistant')assert.match(source,/require\('\.\/device-runtime'\)\.protect\('assistant', exports\.main\)/);
  else assert.match(source,new RegExp(`exports\\.main = require\\('./device-runtime'\\)\\.protect\\('${name}', exports\\.main\\);`),`${name} must use its deployed device wrapper`);
  for(const file of ['device-control.js','device-proof.js','device-runtime.js'])
   assert.ok(fs.existsSync(path.join(root,'cloudfunctions',name,file)),`${name}/${file} must be checked in`);
 }
});

test('verified activity assertion is required to issue a scoped service delegation',async()=>{
 const previous={fetch:global.fetch,env:process.env.TCB_ENV,key:process.env.CRM_PERSON360_DB_API_KEY};
 process.env.TCB_ENV='crm-devicetest';process.env.CRM_PERSON360_DB_API_KEY='test-secret-not-for-production-'.repeat(4);
 const {verifyOnly}=require('../../cloudfunctions/person_360/device-verifier');
 const runtime=require('../../cloudfunctions/person_360/device-runtime');
 const activitiesRuntimeSource=fs.readFileSync(path.join(root,'cloudfunctions/activities/device-runtime.js'),'utf8');
 assert.doesNotMatch(activitiesRuntimeSource,/CRM_PERSON360_DB_API_KEY/);
 const actor='member-123',fingerprint='b'.repeat(64),payload={action:'listActivityData',activityId:'42'};
 let calls=[];
 global.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url:String(url),options,body});
  const data=body.p_op==='issue'?{token:crypto.randomUUID()}:{actor,origin:'browser',fingerprint};
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const request={action:'getActivityData',activityId:'42',__deviceProof:{fingerprint,challenge:crypto.randomUUID(),signature:'unused-by-stub'}};
  const verified=await verifyOnly({audience:'activities',request},{},async()=>actor,{protocol:{authorize:async()=>({ok:true})}});
  assert.equal(verified.verified,true);assert.equal(verified.actor,actor);assert.equal(typeof verified.attestation,'string');
  const [attBody,attMac]=verified.attestation.split('.');
  assert.equal(crypto.createHmac('sha256',process.env.CRM_PERSON360_DB_API_KEY).update(attBody).digest('base64url'),attMac);
  const claims=JSON.parse(Buffer.from(attBody,'base64url').toString('utf8'));
  assert.equal(claims.source,'activities');assert.equal(claims.actor,actor);assert.ok(claims.expiresAt>=Date.now());
  assert.doesNotThrow(()=>runtime.verifiedDeviceAttestation(verified.attestation));
  const app={auth:()=>({getUserInfo:()=>({uid:actor,isAnonymous:false})})};
  const issue=runtime.protect('person_360',async()=>({ok:true}),()=>app);
  const direct=await runtime.issueInternalDelegation(app,{action:'issueInternalDelegation',attestation:verified.attestation,payload});
  assert.match(direct.token,/^[a-f0-9-]{36}$/);assert.equal(calls.length,1);
  const issued=await issue({action:'issueInternalDelegation',attestation:verified.attestation,payload});
  assert.ok(issued.token,JSON.stringify({issued,calls:calls.map(c=>c.body.p_op)}));assert.match(issued.token,/^[a-f0-9-]{36}$/);
  assert.equal(calls.length,2);
  assert.equal(calls[1].body.p_op,'issue');assert.equal(calls[1].body.p_args.actor,actor);
  assert.equal(calls[1].body.p_args.origin,'browser');assert.equal(calls[1].body.p_args.fingerprint,fingerprint);
  const denied=await issue({action:'issueInternalDelegation',attestation:verified.attestation,payload:{action:'deleteCustomer',id:1}});
  assert.equal(denied.error,'DEVICE_ACCESS_DENIED');assert.equal(calls.length,2);
  const dot=verified.attestation.indexOf('.'),signature=verified.attestation[dot+1];
  const corrupted=verified.attestation.slice(0,dot+1)+(signature==='A'?'B':'A')+verified.attestation.slice(dot+2);
  const forged=await issue({action:'issueInternalDelegation',attestation:corrupted,payload});
  assert.equal(forged.error,'DEVICE_ACCESS_DENIED');assert.equal(calls.length,2);
  assert.equal(calls[1].options.headers.Authorization,'Bearer '+process.env.CRM_PERSON360_DB_API_KEY);
  assert.equal(calls[1].options.headers['Content-Profile'],'public');
  const activityRuntime=require('../../cloudfunctions/activities/device-runtime');
  const personHandler=runtime.protect('person_360',async event=>({ok:true,actor:runtime.callerIdentity(app).uid,action:event.action}),()=>app);
  const activityApp={
   auth:()=>({getUserInfo:()=>({uid:actor,isAnonymous:false})}),
   callFunction:async request=>{
    if(request.name!=='person_360')throw Error('Unexpected target');
    if(request.data.action==='verifyBusinessDeviceOnly')return {result:verified};
    return {result:await personHandler(request.data)};
   }
  };
  const activityHandler=activityRuntime.protect('activities',async event=>activityRuntime.scopedApp(activityApp).callFunction({
   name:'person_360',data:{action:'listActivityData',activityId:String(event.activityId)}
  }),()=>activityApp);
  const response=await activityHandler({__deviceRequest:{action:'getActivityData',activityId:'42',__deviceProof:{fingerprint,challenge:crypto.randomUUID()}}});
  assert.deepEqual(response,{result:{ok:true,actor,action:'listActivityData'}});
  assert.equal(calls.length,4);assert.deepEqual(calls.map(c=>c.body.p_op),['issue','issue','issue','consume']);
  const rosterHandler=activityRuntime.protect('activities',async()=>activityRuntime.scopedApp(activityApp).callFunction({
   name:'person_360',data:{action:'getRosterFacts',query:{activityIds:[42],after:0}}
  }),()=>activityApp);
  const rosterResponse=await rosterHandler({__deviceRequest:{action:'get',id:42,__deviceProof:{fingerprint,challenge:crypto.randomUUID()}}});
  assert.deepEqual(rosterResponse,{result:{ok:true,actor,action:'getRosterFacts'}});
  assert.equal(calls.length,6);assert.deepEqual(calls.slice(-2).map(c=>c.body.p_op),['issue','consume']);
 }finally{
  global.fetch=previous.fetch;
  if(previous.env===undefined)delete process.env.TCB_ENV;else process.env.TCB_ENV=previous.env;
  if(previous.key===undefined)delete process.env.CRM_PERSON360_DB_API_KEY;else process.env.CRM_PERSON360_DB_API_KEY=previous.key;
 }
});

test('activity report delegates only the fixed recruit goal read through person_360 attestation',async()=>{
 const previous={fetch:global.fetch,env:process.env.TCB_ENV,key:process.env.CRM_PERSON360_DB_API_KEY};
 process.env.TCB_ENV='crm-devicetest';process.env.CRM_PERSON360_DB_API_KEY='test-secret-not-for-production-'.repeat(4);
 const {verifyOnly}=require('../../cloudfunctions/person_360/device-verifier');
 const runtime=require('../../cloudfunctions/person_360/device-runtime');
 const reportsRuntime=require('../../cloudfunctions/activity_reports/device-runtime');
  const goalsRuntime=require('../../cloudfunctions/recruit_goals/device-runtime');
  const {canonical,digest}=require('../../cloudfunctions/person_360/device-proof');
 const actor='member-report-123',fingerprint='c'.repeat(64),payload={action:'getProgress',startMonth:'2026-10',endMonth:'2026-11'};
 const calls=[];
 global.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url:String(url),body});
  const data=body.p_op==='issue'?{token:crypto.randomUUID()}:{actor,origin:'browser',fingerprint};
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const request={action:'recruit',mode:'range',startDate:'2026-10-01',endDate:'2026-11-30',__deviceProof:{fingerprint,challenge:crypto.randomUUID(),signature:'unused-by-stub'}};
  const verified=await verifyOnly({audience:'activity_reports',request},{},async()=>actor,{protocol:{authorize:async()=>({ok:true})}});
  assert.equal(verified.verified,true);assert.equal(verified.actor,actor);assert.equal(typeof verified.attestation,'string');
  const claims=JSON.parse(Buffer.from(verified.attestation.split('.')[0],'base64url').toString('utf8'));
  assert.equal(claims.source,'activity_reports');assert.equal(claims.fingerprint,fingerprint);
  assert.doesNotThrow(()=>runtime.verifiedDeviceAttestation(verified.attestation));
  const app={
   auth:()=>({getUserInfo:()=>({uid:actor,isAnonymous:false})}),
   callFunction:async call=>{
    if(call.name==='person_360'&&call.data.action==='verifyBusinessDeviceOnly')return {result:verified};
    if(call.name==='person_360')return {result:await personHandler(call.data)};
    if(call.name==='recruit_goals')return {result:await goalHandler(call.data)};
    throw Error('Unexpected target '+call.name);
   }
  };
  const personHandler=runtime.protect('person_360',async()=>({ok:true}),()=>app);
  const goalHandler=goalsRuntime.protect('recruit_goals',async event=>({ok:true,action:event.action,actor:goalsRuntime.callerIdentity(app).uid}),()=>app);
  const reportHandler=reportsRuntime.protect('activity_reports',async()=>{
   const result=await reportsRuntime.internalCall(app,{name:'recruit_goals',data:payload});return result.result;
  },()=>app);
  const response=await reportHandler({__deviceRequest:request});
  assert.deepEqual(response,{ok:true,action:'getProgress',actor});
  assert.deepEqual(calls.map(call=>[call.body.p_op,call.body.p_args.audience]),[['issue','recruit_goals'],['consume','recruit_goals']]);
  assert.equal(calls[0].body.p_args.actor,actor);assert.equal(calls[0].body.p_args.origin,'browser');
  assert.equal(calls[0].body.p_args.payload_hash,digest(canonical(payload)));
  const invalid=await personHandler({action:'issueInternalDelegation',attestation:verified.attestation,
   payload:{action:'getProgress',startMonth:'2026-01',endMonth:'2027-02'}});
  assert.equal(invalid.error,'DEVICE_ACCESS_DENIED');assert.equal(calls.length,2);
  const forged=await personHandler({action:'issueInternalDelegation',attestation:verified.attestation,
   payload:{...payload,includeDeleted:true}});
  assert.equal(forged.error,'DEVICE_ACCESS_DENIED');assert.equal(calls.length,2);
 }finally{
  global.fetch=previous.fetch;
  if(previous.env===undefined)delete process.env.TCB_ENV;else process.env.TCB_ENV=previous.env;
  if(previous.key===undefined)delete process.env.CRM_PERSON360_DB_API_KEY;else process.env.CRM_PERSON360_DB_API_KEY=previous.key;
 }
});

test('assistant, follow-up, recommend and referral receive only fixed browser delegated reads and OCR routes',async()=>{
 const previous={fetch:global.fetch,env:process.env.TCB_ENV,key:process.env.CRM_PERSON360_DB_API_KEY};
 process.env.TCB_ENV='crm-devicetest';process.env.CRM_PERSON360_DB_API_KEY='test-secret-not-for-production-'.repeat(4);
 const {verifyOnly}=require('../../cloudfunctions/person_360/device-verifier');
 const runtime=require('../../cloudfunctions/person_360/device-runtime');
 const actor='member-internal-123',fingerprint='c'.repeat(64),issued=[];
 global.fetch=async(_url,options)=>{
  const body=JSON.parse(options.body);issued.push(body);
  const result=body.p_op==='issue'?{token:crypto.randomUUID()}:{actor,origin:'browser',fingerprint};
  return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  for(const [source,audience,payload,expectedAudience] of [
   ['assistant','assistant',{action:'getMeetingPrepContext',personId:'783'},'person_360'],
   ['assistant','assistant',{action:'ocr_knowledge_source',fileName:'page-1.jpg',contentType:'image/jpeg',base64:'AA=='},'ai_parse'],
   ['assistant','assistant',{action:'daily_review',view:'morning'},'today_coach'],
   ['ai_followup','ai_followup',{action:'listInteractions',personId:'17',limit:5},'person_360'],
   ['ai_recommend','ai_recommend',{action:'listInteractions',personId:'17',limit:5},'person_360'],
   ['ai_referral','ai_referral',{action:'listInteractions',personId:'17',limit:8},'person_360'],
  ]){
   const request={action:'parse',__deviceProof:{fingerprint,challenge:crypto.randomUUID(),signature:'unused-by-stub'}};
   const attested=await verifyOnly({audience,request},{},async()=>actor,{protocol:{authorize:async()=>({ok:true})}});
   if(payload.action==='getMeetingPrepContext'){
     const assistant=require('../../cloudfunctions/assistant/device-runtime');
     const person=runtime.protect('person_360',async input=>({person:{id:input.personId}}),()=>({}));
     const client={auth:()=>({getUserInfo:()=>({uid:actor,isAnonymous:false})}),callFunction:async({data})=>{
       if(data.action==='verifyBusinessDeviceOnly')return {result:attested};
       const result=await person({...data,userInfo:{uid:actor},requestId:'fixture-request'});
       return {result};
     }};
     const read=assistant.protect('assistant',async()=>assistant.scopedApp(client).callFunction({name:expectedAudience,data:payload}),()=>client);
     const response=await read({__deviceRequest:request});
     assert.deepEqual(response,{result:{person:{id:'783'}}});
     assert.deepEqual(issued.slice(-2).map(r=>r.p_op),['issue','consume']);
     const invalid=await person({action:'issueInternalDelegation',contextRead:{attestation:attested.attestation,
       payload:{action:'getMeetingPrepContext'}}});
     assert.equal(invalid.error,'DEVICE_ACCESS_DENIED');
     continue;
   }
   const result=await runtime.issueInternalDelegation({}, {action:'issueInternalDelegation',attestation:attested.attestation,payload});
   assert.match(result.token,/^[a-f0-9-]{36}$/);
   assert.equal(issued.at(-1).p_args.audience,expectedAudience);
   assert.equal(issued.at(-1).p_args.actor,actor);
   const consume=runtime.protect('person_360',async()=>({ok:true}),()=>({}));
   const consumed=await consume({action:'consumeInternalDelegation',audience:expectedAudience,token:result.token,payload});
   assert.equal(consumed.verified,true);assert.equal(consumed.actor,actor);assert.deepEqual(consumed.payload,payload);
  }
  const followup={action:'listInteractions',personId:'17',limit:5};
  const attested=await verifyOnly({audience:'ai_followup',request:{action:'parse',__deviceProof:{fingerprint,challenge:crypto.randomUUID(),signature:'unused'}}}, {},async()=>actor,{protocol:{authorize:async()=>({ok:true})}});
  const rejected=await runtime.protect('person_360',async()=>({ok:true}),()=>({auth:()=>({getUserInfo:()=>({uid:actor})})}))(
   {action:'issueInternalDelegation',attestation:attested.attestation,payload:{action:'deletePerson',personId:'17'}});
  assert.equal(rejected.error,'DEVICE_ACCESS_DENIED');
  assert.equal(issued.filter(row=>row.p_op==='issue').length,6);
  assert.equal(followup.limit,5);
 }finally{
  global.fetch=previous.fetch;
  if(previous.env===undefined)delete process.env.TCB_ENV;else process.env.TCB_ENV=previous.env;
  if(previous.key===undefined)delete process.env.CRM_PERSON360_DB_API_KEY;else process.env.CRM_PERSON360_DB_API_KEY=previous.key;
 }
});
