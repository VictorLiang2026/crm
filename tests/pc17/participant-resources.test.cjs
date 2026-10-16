'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {ParticipantService}=require('../../cloudfunctions/person_360/participant-service');

function fixture({participant={}, duplicate=false, personDeleted=false}={}){
  const tables={
    persons:[{id:22,display_name:'【系统测试·勿联系】李宁',name_key:'【系统测试·勿联系】李宁',deleted_at:personDeleted?'2026-10-15':null}],
    customers:[],recruit_candidates:[],activity_speakers:[],activities:[{id:301,deleted_at:null}],
    activity_participants:[{id:401,activity_id:301,person_type:'customer',person_id:null,canonical_person_id:null,
      person_name:'待确认姓名',status:'invited',updated_at:'2026-10-16T04:00:00.000Z',deleted_at:null,...participant}],
  };
  const calls=[];
  const request=async(table,method,filters={},body)=>{
    calls.push({table,method,filters,body});
    if(method==='PATCH'){
      const rows=tables[table].filter(row=>Object.entries(filters).every(([key,value])=>{
        if(['select','order','limit'].includes(key))return true;
        if(value==='is.null')return row[key]==null;
        if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
        throw Error('Unexpected filter '+key);
      }));
      if(rows.length===1)Object.assign(rows[0],body);
      return rows;
    }
    assert.equal(method,'GET');
    return tables[table].filter(row=>Object.entries(filters).every(([key,value])=>{
      if(['select','order','limit'].includes(key))return true;
      if(value==='is.null')return row[key]==null;
      if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
      throw Error('Unexpected filter '+key);
    })).slice(0,Number(filters.limit||100));
  };
  if(duplicate)tables.activity_participants.push({id:402,activity_id:301,person_type:'recruit',person_id:null,
    canonical_person_id:22,updated_at:'2026-10-16T04:02:00.000Z',deleted_at:null});
  return {service:new ParticipantService({request}),tables,calls};
}

const payload={participantId:'401',activityId:'301',canonicalPersonId:'22',selectedDisplayName:'【系统测试·勿联系】李宁',
  expectedUpdatedAt:'2026-10-16T04:00:00.000Z',confirmed:true};

test('PC17 canonical participant linking re-resolves identity and preserves legacy fields',async()=>{
  const f=fixture();
  const result=await f.service.link(payload,'test-user');
  assert.deepEqual(result,{ok:true,canonicalPersonId:'22',legacyLinked:false});
  const row=f.tables.activity_participants[0];
  assert.equal(row.canonical_person_id,22);assert.equal(row.person_id,null);
  assert.equal(row.person_type,'customer');assert.equal(row.person_name,payload.selectedDisplayName);
  const patch=f.calls.find(call=>call.method==='PATCH');
  assert.equal(patch.filters.updated_at,'eq.'+payload.expectedUpdatedAt);
  assert.equal(patch.filters.canonical_person_id,'is.null');
});

test('PC17 rejects stale, ambiguous, deleted, and duplicate identities without a write',async()=>{
  for(const [fixtureOptions,data,pattern] of [
    [{},{...payload,expectedUpdatedAt:'2026-10-16T03:00:00.000Z'},/changed or unavailable/],
    [{duplicate:true},payload,/already added/],
    [{personDeleted:true},payload,/Selected Person changed/],
    [{participant:{person_id:999}},payload,/Legacy identity does not match/],
    [{},{...payload,confirmed:false},/Human confirmation/],
  ]){
    const f=fixture(fixtureOptions);
    await assert.rejects(f.service.link(data,'test-user'),pattern);
    assert.equal(f.calls.some(call=>call.method==='PATCH'),false);
  }
});

test('PC17 server write actions remain scoped and do not write interactions on attendance',()=>{
  const activities=fs.readFileSync(path.join(__dirname,'../../cloudfunctions/activities/index.js'),'utf8');
  const speakers=fs.readFileSync(path.join(__dirname,'../../cloudfunctions/activity_speakers/index.js'),'utf8');
  const topics=fs.readFileSync(path.join(__dirname,'../../cloudfunctions/activity_topics/index.js'),'utf8');
  const person=fs.readFileSync(path.join(__dirname,'../../cloudfunctions/person_360/index.js'),'utf8');
  assert.match(activities,/case 'updateParticipantConsole'/);
  assert.match(activities,/\.eq\('id', id\)\.eq\('activity_id', activityId\)\.eq\('status', expectedStatus\)[\s\S]*?\.eq\('updated_at', expectedUpdatedAt\)/);
  assert.match(activities,/case 'applyTopicsConsole'/);
  assert.match(speakers,/case 'previewRemoveConsole'/);assert.match(speakers,/speaker has participant records/);
  assert.match(topics,/case 'previewRemoveConsole'/);assert.match(topics,/topic is used by activities/);
  assert.match(person,/case 'linkCanonicalParticipant'/);
  assert.match(activities,/Attendance remains a participation fact; this action never creates an Interaction/);
});
