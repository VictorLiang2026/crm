'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runSearchV2,validateFilters,normalizePage}=require('../../cloudfunctions/assistant/search-v2-service');

function filters(overrides={}) { return {roles:null,relationshipTypes:null,fact:null,attendanceMonths:null,
  followupState:null,followupMonths:null,opportunityStatuses:null,opportunityTypes:null,recruitStages:null,...overrides}; }
function deps(result,{resolution={status:'confirm_existing',candidates:[{id:'42',displayName:'林华',organization:'North',occupation:'Manager'}]},rows=[]}={}) {
  const calls={resolved:[],searched:[],audited:[]};
  return {calls,data:{auditRdb:{},resolveName:async name=>{calls.resolved.push(name);return resolution;},
    searchV2:async(...args)=>{calls.searched.push(args);return {total:rows.length,rows,filterLabels:['roles']};},
    linkTestAudit:async(...args)=>calls.audited.push(args),testDataReader:async refs=>({status:'verified',containsTestData:false,recordCount:0,sources:[]})},
    gateway:{runAITask:async()=>({taskId:7,resultId:8,result})}};
}
const supported={status:'supported',interpretation:'客户有近期到场记录',personMention:null,filters:filters({roles:['customer'],attendanceMonths:3})};

test('accepts only bounded enum filters and 1..8 supported conditions',()=>{
  assert.deepEqual(validateFilters(supported.filters),supported.filters);
  assert.throws(()=>validateFilters({...filters({roles:['customer']}),sql:'select *'}),{code:'INVALID_RESULT'});
  assert.throws(()=>validateFilters(filters({fact:{category:'x',contains:'a%'}})),{code:'INVALID_RESULT'});
  assert.throws(()=>validateFilters(filters({attendanceMonths:25})),{code:'INVALID_RESULT'});
  assert.throws(()=>validateFilters(filters({roles:['customer','customer']})),{code:'INVALID_RESULT'});
  assert.throws(()=>validateFilters(filters({roles:['customer','recruit','speaker','participant','customer']})),{code:'INVALID_RESULT'});
  assert.equal(validateFilters(filters({followupState:'none'})).followupMonths,3);
  assert.doesNotThrow(()=>validateFilters(filters({roles:['customer'],relationshipTypes:['friend'],fact:{category:'x',contains:'y'},attendanceMonths:1,followupState:'recent',followupMonths:2,opportunityStatuses:['沟通'],opportunityTypes:['recruit'],recruitStages:['接触']})));
});

test('rejects unsafe pagination before model or database work',()=>{
  for(const page of [0,-1,12,1.5,'2 OR 1=1']) assert.throws(()=>normalizePage(page));
});

test('unsupported request returns without reading business rows',async()=>{
  const d=deps({status:'unsupported',interpretation:'unsupported',personMention:null,filters:filters()});
  const out=await runSearchV2({query:'do something unsupported'},d);
  assert.equal(out.status,'unsupported');assert.equal(d.calls.searched.length,0);
});

test('ambiguous Person reference waits for a human selection',async()=>{
  const d=deps({...supported,personMention:'林华'});
  const out=await runSearchV2({query:'查林华的客户机会'},d);
  assert.equal(out.status,'needs_person_selection');assert.equal(out.requiresHumanDecision,true);
  assert.deepEqual(d.calls.resolved,['林华']);assert.equal(d.calls.searched.length,0);
});

test('re-resolves the selected Person before fixed paged search',async()=>{
  const d=deps({...supported,personMention:'林华'},{rows:[{person_id:42,display_name:'林华',sources:{persons:['42']}}]});
  const out=await runSearchV2({query:'查林华近期到场的客户',selectedPersonId:'42',page:2},d);
  assert.equal(out.status,'complete');assert.equal(out.page,2);assert.equal(out.total,1);
  assert.equal(d.calls.resolved.length,1);assert.equal(d.calls.searched[0][1],50);assert.equal(d.calls.searched[0][2],50);
  assert.equal(d.calls.searched[0][0].personId,'42');
});

test('rejects model hallucinated or stale Person IDs',async()=>{
  const d=deps({...supported,personMention:'林华'});
  await assert.rejects(runSearchV2({query:'查林华',selectedPersonId:'999'},d),{code:'INVALID_INPUT'});
  await assert.rejects(runSearchV2({query:'查林华',selectedPersonId:'42 OR 1=1'},d),{code:'INVALID_INPUT'});
  assert.equal(d.calls.searched.length,0);
});

test('passes real row provenance through test-data disclosure',async()=>{
  const d=deps(supported,{rows:[{person_id:42,display_name:'林华',sources:{persons:['42'],opportunities:['19']}}]});
  const out=await runSearchV2({query:'客户有近期到场记录'},d);
  assert.equal(out.execution.businessDataWritten,false);assert.equal(out.resultSource,'public.crm_search_people_v2');
  assert.deepEqual(d.calls.searched[0].slice(1),[50,0]);
});

test('marks the fixed search window as truncated instead of claiming it is complete',async()=>{
  const d=deps(supported);d.data.searchV2=async()=>({total:900,rows:[],filterLabels:['roles']});
  const out=await runSearchV2({query:'customers',page:11},d);
  assert.equal(out.hasMore,true);assert.equal(out.truncated,true);assert.equal(out.pageSize,50);
});
