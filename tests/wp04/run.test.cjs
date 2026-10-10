'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PersonService,parsePersonName}=require('../../cloudfunctions/_shared/person-service');
const {ParticipantService}=require('../../cloudfunctions/person_360/participant-service');
const {SpeakerProfileService}=require('../../cloudfunctions/person_360/speaker-profile-service');
const {evaluate}=require('./audit.cjs');
const name='【系统测试·勿联系】虚构同名甲';
function fixture(){
 const tables={persons:[1,2].map(id=>({id,display_name:name,name_key:parsePersonName(name).nameKey,deleted_at:null})),
  customers:[{Id:101,person_id:1},{Id:102,person_id:2}],activities:[{id:301}],activity_participants:[],activity_speakers:[],recruit_candidates:[]};
 const writes=[],reads=[];
 async function request(table,method,filters={},body){
  assert.ok(Object.hasOwn(tables,table));
  if(method==='POST'){const row={id:401,...body};writes.push({table,body});tables[table].push(row);return[row];}
  assert.equal(method,'GET');reads.push({table,filters});
  return tables[table].filter(row=>Object.entries(filters).every(([key,value])=>{
   if(['select','order','limit'].includes(key))return true;
   if(value==='is.null')return row[key]==null;
   if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
   if(value.startsWith('in.('))return value.slice(4,-1).split(',').map(s=>s.trim()).includes(String(row[key]));
   throw Error('Unexpected fixture filter');
  })).slice(0,Number(filters.limit||100));
 }
 return{tables,writes,reads,request};
}
test('same full name, qualifier match and single match never select a Person',async()=>{
 const f=fixture(),s=new PersonService({request:f.request});
 let r=await s.resolveName(name);assert.equal(r.status,'choose_or_qualify');assert.equal(r.selectedPersonId,null);
 f.tables.persons[1].display_name=name+'（虚构学校）';r=await s.resolveName(name+'（虚构学校）');
 assert.equal(r.status,'confirm_qualified_match');assert.equal(r.selectedPersonId,null);assert.deepEqual(r.qualifierMatches,['2']);
 f.tables.persons.splice(0,1);r=await s.resolveName(name);assert.equal(r.status,'confirm_existing');assert.equal(r.selectedPersonId,null);
 assert.equal(f.writes.length,0);
});
test('truncated same-name results cannot claim a unique identity',async()=>{
 const f=fixture();f.tables.persons=Array.from({length:11},(_,i)=>({...f.tables.persons[0],id:i+1}));
 const r=await new PersonService({request:f.request}).resolveName(name);
 assert.equal(r.hasMore,true);assert.equal(r.status,'choose_or_qualify');assert.equal(r.selectedPersonId,null);assert.equal(r.candidates.length,10);
});
const selected={activityId:301,canonicalPersonId:2,personType:'customer',selectedDisplayName:name,confirmed:true,relationshipNote:'【系统测试·勿联系】虚构邀约'};
test('participant uses the explicitly chosen second same-name identity and its exact customer ID',async()=>{
 const f=fixture(),s=new ParticipantService({request:f.request});await s.add(selected,'crm_test_actor');
 assert.equal(f.writes[0].body.canonical_person_id,2);assert.equal(f.writes[0].body.person_id,102);
 assert.ok(f.reads.some(r=>r.table==='persons'&&r.filters.name_key));
 await assert.rejects(s.add(selected,'crm_test_actor'),/already added/);assert.equal(f.writes.length,1);
});
test('speaker uses the chosen same-name identity; no caller identity-field override',async()=>{
 const f=fixture();await new SpeakerProfileService({request:f.request}).create({personId:2,selectedDisplayName:name,confirmed:true,
  profile:{person_id:1,customer_id:101,name:'【系统测试·勿联系】伪选',notes:'【系统测试·勿联系】虚构档案'}},'crm_test_actor');
 assert.equal(f.writes[0].body.person_id,2);assert.equal(f.writes[0].body.customer_id,102);assert.equal(f.writes[0].body.name,name);
 assert.ok(f.reads.some(r=>r.table==='persons'&&r.filters.name_key));
});
test('missing confirmation, missing caller, forged and deleted identity produce zero writes',async()=>{
 for(const mode of ['confirmation','caller','forged','deleted','changed']){
  const f=fixture(),data={...selected};let uid='crm_test_actor';
  if(mode==='confirmation')data.confirmed=false;if(mode==='caller')uid='';if(mode==='forged')data.canonicalPersonId=99;
  if(mode==='deleted')f.tables.persons[1].deleted_at='2026-10-03';if(mode==='changed')data.selectedDisplayName=name+'（已变更）';
  await assert.rejects(new ParticipantService({request:f.request}).add(data,uid));assert.equal(f.writes.length,0);
  await assert.rejects(new SpeakerProfileService({request:f.request}).create({...data,personId:data.canonicalPersonId},uid));assert.equal(f.writes.length,0);
 }
});
test('Person-only participants retain null legacy identity; read failure never writes',async()=>{
 const f=fixture();f.tables.customers=f.tables.customers.filter(c=>c.Id!==102);
 await new ParticipantService({request:f.request}).add(selected,'crm_test_actor');
 assert.equal(f.writes[0].body.person_id,null);assert.equal(f.writes[0].body.canonical_person_id,2);
 const failed=fixture();const request=async(...args)=>{if(args[0]==='persons')throw Error('fictional read failure');return failed.request(...args);};
 await assert.rejects(new ParticipantService({request}).add(selected,'crm_test_actor'),/Person search failed/);assert.equal(failed.writes.length,0);
});
function snapshot(){return{version:'wp04-v1',schema:'public',environment:'crm-d1gkae8ddc930d151',observedAt:new Date().toISOString(),initialTestRows:10,
 summary:['customers','recruits','speakers','participants'].map(kind=>({kind,active:1,mapped:1,exceptions:0})),exceptions:[]};}
test('identity audit distinguishes mapped coverage from explicitly documented exceptions',()=>{
 const s=snapshot(),exception={kind:'customers',id:'91',issue:'UNMAPPED_CUSTOMER'};
 s.summary[0]={kind:'customers',active:1,mapped:0,exceptions:1};s.exceptions=[exception];
 const r=evaluate(s,[exception]);assert.equal(r.status,'PASS_WITH_EXCEPTIONS');assert.equal(r.coverage[0].mapped,0);
 assert.equal(evaluate(s,[]).status,'FAIL');assert.equal(evaluate(snapshot(),[exception]).status,'PASS');
});
test('identity gate refuses incomplete, stale, conflicting and enlarged seed evidence',()=>{
 for(const mutate of [s=>s.summary.pop(),s=>s.summary[0].mapped=0,s=>s.summary[0].mapped='1',s=>delete s.exceptions,
  s=>s.observedAt='2000-01-01',s=>s.initialTestRows=11,s=>s.environment='fixture_wrong',
  s=>{s.summary[0]={kind:'customers',active:1,mapped:0,exceptions:1};s.exceptions=[{kind:'customers',id:'91',issue:'IDENTITY_CONFLICT'}];}]){
  const s=snapshot();mutate(s);assert.equal(evaluate(s,s.exceptions||[]).status,'FAIL');
 }
});
