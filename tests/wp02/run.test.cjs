'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const TD=require('../../cloudfunctions/_shared/test-data');
const {previewPlan,seedRequest}=require('../../cloudfunctions/assistant/test-seed-policy');
const batch='crm_test_wp_two', marker=TD.MARKER;
const summary={status:'verified',containsTestData:true,recordCount:1,sources:[{batchKey:batch,table:'customers',count:1}]};
const row=(key,effects=[])=>({table:'persons',seedKey:key,visibleText:marker+'虚构人物',outbound:false,effects});
const registered=(i,b=batch)=>({batch_key:b,origin:'initial',initial_slot:i,seed_key:'person_'+i,record_table:'persons',record_id:String(900000+i)});
function fixtureDb(data,ledger=[]) {
 const writes=[],reads=[],rpcCalls=[];
 const db={writes,reads,rpcCalls,from(table) {
  assert.ok(TD.TABLES.has(table)||['v_funnel_stats','v_action_center'].includes(table));
  reads.push(table);let filters=[],limit=Infinity,sort=[];
  const q={select(){return q;},is(k,v){filters.push(r=>v===null?r[k]==null:r[k]===v);return q;},
   eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},
   gte(k,v){filters.push(r=>r[k]>=v);return q;},lte(k,v){filters.push(r=>r[k]<=v);return q;},
   lt(k,v){filters.push(r=>r[k]<v);return q;},order(k,o){sort.push([k,o]);return q;},limit(n){limit=n;return q;},
   then(resolve,reject){return Promise.resolve().then(()=>({data:structuredClone(data[table]||[]).filter(r=>filters.every(f=>f(r))).sort((a,b)=>{for(const[k,o]of sort){let n=String(a[k]??'').localeCompare(String(b[k]??''));if(n)return o?.ascending?n:-n;}return 0;}).slice(0,limit)})).then(resolve,reject);}
  };
  for(const op of ['insert','update','delete','upsert'])q[op]=()=>{writes.push(op);throw Error('WRITE_FORBIDDEN');};
  return q;
 },async rpc(name,args){
  assert.equal(name,'crm_test_disclosure_v1');rpcCalls.push(args);
  const refs=new Set(args.p_refs.map(r=>r.table+':'+r.id));
  const matches=ledger.filter(r=>args.p_scope==='funnel'?['customers','opportunities','recruit_candidates'].includes(r.table):refs.has(r.table+':'+r.id));
  const groups=new Map();
  for(const r of matches){const k=r.batchKey+':'+r.table;groups.set(k,{batchKey:r.batchKey,table:r.table,count:(groups.get(k)?.count||0)+1});}
  return {data:{status:'verified',containsTestData:matches.length>0,recordCount:matches.length,sources:[...groups.values()]}};
 }};
 return db;
}
function load(name,data,ledger=[]) {
 const rdb=fixtureDb(data,ledger),exports={};
 const db={rdb,app:{auth:()=>({getUserInfo:()=>({uid:'crm_test_actor',isAnonymous:false})}),callFunction:async()=>({result:{rows:[]}})},
  assertOk:r=>{if(r?.error)throw Error('READ_FAILED');return r;},nowIso:()=>new Date().toISOString(),
  normFields:x=>x,generateText:async()=>{throw Error('REAL_AI_FORBIDDEN');},extractJson:JSON.parse};
 const testData={...TD,disclose:(refs,options={})=>TD.disclose(refs,{...options,rdb})};
 const context={exports,module:{exports},console,setTimeout,clearTimeout,process:{env:{}},Date,Map,Set,Buffer,
 require(dep){
  if(dep==='./db')return db;
  if(dep==='./test-data')return testData;
  if(dep==='./action-facts')return {...require('../../cloudfunctions/today_coach/action-facts'),readOpenActions:async()=>({rows:data.actions||[],persons:data.persons||[]})};
  if(dep.startsWith('./'))return require(path.join(root,'cloudfunctions',name,dep));
  if(dep==='crypto')return require('node:crypto');
  throw Error('DEPENDENCY_FORBIDDEN '+dep);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(root,'cloudfunctions',name,'index.js'),'utf8'),context);
 return {main:exports.main,rdb};
}
const plain=v=>JSON.parse(JSON.stringify(v));

test('AI Search includes marked matching rows without altering SQL criteria or totals',async()=>{
 const {runSearch}=require('../../cloudfunctions/assistant/search-service');
 const rows=[{person_id:910001,legacy_customer_id:920001,display_name:marker+'虚构甲',relationship_id:930001}];
 const db=fixtureDb({},[{batchKey:batch,table:'customers',id:'920001'}]),calls=[];
 const response=await runSearch({query:marker+'最近关系下降的重点客户'},{app:{},
  gateway:{runAITask:async()=>({result:{template:'declining_priority',months:3},taskId:'fixture-task',resultId:'fixture-result'})},
  data:{search:async(...args)=>{calls.push(args);return {rows,total:1,coverage:{rows:1}};},linkTestAudit:async()=>({ok:true}),testDataReader:refs=>TD.disclose(refs,{rdb:db})}});
 assert.deepEqual(calls,[['declining_priority',3,30]]);assert.equal(response.total,1);
 assert.deepEqual(response.rows,rows);assert.equal(response.testData.containsTestData,true);assert.equal(response.execution.businessDataWritten,false);
});
test('AI Gateway sends fictional provenance to the model and preserves task/run/result trace',async()=>{
 const {createAIGateway}=require('../../cloudfunctions/_shared/ai-gateway');
 const saved={},calls=[];
 const store={createTask:async r=>(saved.task=r,'fixture-task'),updateTask:async()=>{},
  createRun:async r=>(saved.run=r,'fixture-run'),updateRun:async()=>{},createResult:async r=>(saved.result=r,'fixture-result')};
 const app={ai:()=>({createModel:()=>({generateText:async args=>{calls.push(args);return {text:'{"ok":true}'};}})})};
 const definition={version:'fixture',capability:'analysis',outputSchema:{type:'object'},confirmationLevel:'confirm_before_write'};
 const registry={get:()=>definition,validateInput(){},validateContext(){},validateOutput(){}};
 const context={person:{data:{id:910001,display_name:marker+'虚构甲'},source:{schema:'public',table:'persons',id:'910001'}}};
 const gateway=createAIGateway({app,store,skillRegistry:registry,modelResolver:()=> 'configured-fixture-model',
  testDataReader:async refs=>{assert.deepEqual(refs,[{table:'persons',id:'910001'}]);return summary;}});
 const result=await gateway.runAITask({taskType:'fixture',skill:'fixture',capability:'analysis',input:{},context});
 assert.match(JSON.stringify(calls[0]),/含测试数据/);
 assert.deepEqual(saved.task.context_snapshot.person,context.person);
 assert.deepEqual(saved.task.context_snapshot._testData,summary);
 assert.equal(saved.run.task_id,result.taskId);assert.equal(saved.result.run_id,result.runId);
 assert.equal(result.requiresConfirmation,true);assert.equal(result.testData.containsTestData,true);
});

function facts(v) {
 if(Array.isArray(v))return v.map(facts);
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!['testData','fingerprint','generatedAt','generated_at'].includes(k)).map(([k,x])=>[k,facts(x)]));
 return v;
}
test('lowercase batch, visible marker, explicit outbound denial and malformed plans',()=>{
 for(const invalid of ['CRM_TEST_A','crm_test_','pr_demo','crm_test_A'])assert.throws(()=>previewPlan(invalid,[row('one')],[]),/INVALID_PLAN/);
 assert.throws(()=>previewPlan(batch,[{...row('one'),visibleText:'无标记'}],[]),/INVALID_PLAN/);
 assert.throws(()=>previewPlan(batch,[{...row('one'),outbound:true}],[]),/INVALID_PLAN/);
 assert.throws(()=>previewPlan(batch,[{...row('one'),table:'ai_tasks'}],[]),/INVALID_PLAN/);
});
test('initial cap includes trigger and associated writes across batches; repeat plans are idempotent',()=>{
 const prior=Array.from({length:8},(_,i)=>registered(i+1,'crm_test_previous'));
 assert.equal(previewPlan(batch,[row('person',[row('candidate')])],prior).initialTotal,10);
 assert.throws(()=>previewPlan(batch,[row('person',[row('candidate',[row('milestone')])])],prior),/INITIAL_LIMIT_EXCEEDED/);
 const existing=[registered(1),{origin:'derived'},{origin:'ai_audit'}];
 assert.equal(previewPlan(batch,[row('person_1')],existing).initialNew,0);
 assert.equal(previewPlan(batch,[row('person_1')],existing).derivedAndAuditExisting,2);
});
test('seed requests require server identity and allowlist; event claims never authorize writes',async()=>{
 for(const identity of [null,{uid:'crm_test_actor',isAnonymous:true},{uid:'crm_test_other',isAnonymous:false}])
  await assert.rejects(seedRequest({stage:'dryRun',confirmed:true,role:'admin'},identity,{allowedUids:['crm_test_actor']}),/SEED_FORBIDDEN/);
 const identity={uid:'crm_test_actor',isAnonymous:false},opts={allowedUids:['crm_test_actor'],loadManifest:async()=>[],loadScenario:async()=>({batchKey:batch,rows:[row('one')]})};
 assert.equal((await seedRequest({stage:'dryRun',plan:[row('spoof')],count:0},identity,opts)).initialNew,1);
 await assert.rejects(seedRequest({stage:'execute',confirmed:true},identity,opts),/SEED_EXECUTION_DISABLED/);
 await assert.rejects(seedRequest({stage:'dryRun'},identity,{allowedUids:['crm_test_actor']}),/SEED_SCENARIO_NOT_CONFIGURED/);
});
test('only allowlisted public references; deduplicate and never return manifest IDs',async()=>{
 const refs=TD.collectRefs({source:{schema:'public',table:'customers',id:910002},again:'public.customers#910002',bad:'public.pr_fake#1'});
 assert.equal(refs.length,1);
 const db=fixtureDb({},[{batchKey:batch,table:'customers',id:'910002'}]);
 const value=await TD.disclose([...refs,...refs],{rdb:db});
 assert.equal(value.recordCount,1);
 assert.equal(JSON.stringify(value).includes('910002'),false);
 assert.match(TD.message(value),/含测试数据/);
 assert.equal(TD.message(TD.EMPTY()),'');
});
test('detector errors and malformed summaries are visibly unverified, not silently zero',async()=>{
 for(const rdb of [{rpc:async()=>{throw Error('offline');}},{rpc:async()=>({data:{...summary,sources:[{...summary.sources[0],id:'secret'}],recordCount:-1}})}]){
  const value=await TD.disclose([{table:'customers',id:'910002'}],{rdb});
  assert.equal(value.status,'unverified');assert.match(TD.message(value),/暂未核验/);
 }
});
test('chunked provenance is complete and counts each input reference once',async()=>{
 const refs=Array.from({length:2001},(_,i)=>({table:'persons',id:String(900001+i)}));
 const rdb=fixtureDb({},refs.map(r=>({...r,batchKey:batch})));
 const value=await TD.disclose(refs.concat(refs),{rdb});
 assert.equal(value.recordCount,2001);assert.equal(rdb.rpcCalls.length,2);
});
test('recruit funnel retains ordinary counts including a marked row and preserves soft deletion',async()=>{
 const data={recruit_candidates:[{id:910001,stage:'新增人才'},{id:910002,stage:'新增人才'},{id:910003,stage:'新增人才',deleted_at:'2026-10-01'}]};
 const ledger=[{table:'recruit_candidates',id:'910002',batchKey:batch}];
 const marked=load('recruit_candidates',data,ledger),normal=load('recruit_candidates',data);
 const a=plain(await marked.main({action:'funnel'})),b=plain(await normal.main({action:'funnel'}));
 assert.deepEqual(facts(a),facts(b));assert.equal(a.total,2);assert.equal(a.testData.containsTestData,true);assert.deepEqual(marked.rdb.writes,[]);
});
test('SQL funnel facts and small-sample rates are unchanged by annotation',async()=>{
 const data={v_funnel_stats:[{funnel:'customer',stage:'新认识',stage_order:1,kind:'active',current_count:2,entered_30d:2}]};
 const marked=load('funnel_insight',data,[{table:'customers',id:'910002',batchKey:batch}]),normal=load('funnel_insight',data);
 const a=plain(await marked.main({action:'stats'})),b=plain(await normal.main({action:'stats'}));
 assert.deepEqual(facts(a),facts(b));assert.equal(a.funnels[0].total,2);assert.equal(a.funnels[0].rates.length,0);assert.equal(a.funnels[0].testData.containsTestData,true);
});
test('activity report includes marked rows in ordinary date buckets but excludes out-of-range markers',async()=>{
 const data={customers:[{Id:910001,customer_name:marker+'虚构甲',created_at:'2026-10-02T10:00:00+08:00'},{Id:910002,customer_name:marker+'虚构乙',created_at:'2026-09-01T10:00:00+08:00'}]};
 const event={action:'customer',mode:'range',startDate:'2026-10-02',endDate:'2026-10-02'};
 const a=plain(await load('activity_reports',data,[{table:'customers',id:'910001',batchKey:batch}]).main(event));
 const b=plain(await load('activity_reports',data).main(event));
 assert.deepEqual(facts(a),facts(b));assert.equal(a.totals.newCustomers,1);assert.equal(a.testData.containsTestData,true);
 const outside=await load('activity_reports',data,[{table:'customers',id:'910002',batchKey:batch}]).main(event);
 assert.equal(outside.testData.containsTestData,false);
});
test('recruit goals ordinary milestone calculations include marked samples',async()=>{
 const data={recruit_milestones:[{id:910001,to_stage:'新增人才',happened_at:'2026-10-02'},{id:910002,to_stage:'新增人才',happened_at:'2026-10-03'}]};
 const event={action:'getProgress',startMonth:'2026-10',endMonth:'2026-10'};
 const a=plain(await load('recruit_goals',data,[{table:'recruit_milestones',id:'910002',batchKey:batch}]).main(event));
 const b=plain(await load('recruit_goals',data).main(event));
 assert.deepEqual(facts(a),facts(b));assert.equal(a.rows[0].actual,2);assert.equal(a.testData.containsTestData,true);
});
test('Today cockpit rankings and reminders are unchanged; inputs and cache carry provenance',async()=>{
 const data={customers:[{Id:910001,customer_name:marker+'虚构甲',created_at:'2026-10-02',sales_priority:'A'}]};
 const a=plain(await load('today_coach',data,[{table:'customers',id:'910001',batchKey:batch}]).main({action:'cockpit'}));
 const b=plain(await load('today_coach',data).main({action:'cockpit'}));
 assert.equal(a.error,undefined);assert.deepEqual(facts(a),facts(b));assert.equal(a.testData.containsTestData,true);assert.notEqual(a.fingerprint,b.fingerprint);
});
test('AI receives explicit fictional-source notice without replacing context facts',()=>{
 const messages=[{role:'user',content:JSON.stringify({count:2})}],result=TD.withMessages(messages,summary);
 assert.equal(result.length,2);assert.strictEqual(result[1],messages[0]);assert.match(result[0].content,/含测试数据/);assert.match(result[0].content,/禁止真实外发/);
});
test('shared provenance and AI Gateway copies remain identical',()=>{
 for(const dir of ['today_coach','funnel_insight','activity_reports','recruit_goals','recruit_candidates','assistant','ai_activity','person_360'])
  assert.equal(fs.readFileSync(path.join(root,'cloudfunctions',dir,'test-data.js'),'utf8'),fs.readFileSync(path.join(root,'cloudfunctions/_shared/test-data.js'),'utf8'));
 for(const dir of ['assistant','ai_activity'])assert.equal(fs.readFileSync(path.join(root,'cloudfunctions',dir,'ai-gateway.js'),'utf8'),fs.readFileSync(path.join(root,'cloudfunctions/_shared/ai-gateway.js'),'utf8'));
});
test('migration has global unique slots and service-only manifest; rollback refuses populated tables',()=>{
 const migration=fs.readFileSync(path.join(root,'cloudbase/migrations/20261002173000_test_sample_registry.sql'),'utf8');
 const rollback=fs.readFileSync(path.join(root,'cloudbase/migrations/20261002173000_test_sample_registry.rollback.sql'),'utf8');
 assert.match(migration,/initial_slot smallint UNIQUE CHECK \(initial_slot BETWEEN 1 AND 10\)/);
 assert.match(migration,/FORCE ROW LEVEL SECURITY/);assert.match(migration,/SET search_path = pg_catalog/);
 assert.doesNotMatch(migration,/\b(?:INSERT INTO|DELETE FROM|UPDATE public\.)/i);
 assert.doesNotMatch(rollback,/\bCASCADE\b/);assert.match(rollback,/Registry is populated/);
});

