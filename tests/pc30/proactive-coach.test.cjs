'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ProactiveCoachService,candidateKey}=require('../../cloudfunctions/person_360/proactive-coach-service');

const now=new Date('2026-10-17T04:00:00.000Z');
const verified=async()=>({status:'verified',containsTestData:false,recordCount:0,sources:[]});
function fixture({commitments=[],people=[{id:71,display_name:'【系统测试·勿联系】虚构人物',deleted_at:null}],actions=[],decisions=[],failTable=null}={}){
  const calls=[];
  const rows={commitments,persons:people,relationships:[],activities:[],recruit_candidates:[],
    actions,context_items:[],activity_participants:[],recruit_followups:[],interactions:[],crm_proactive_coach_decisions:decisions};
  const request=async(table,method,filters)=>{calls.push({table,method,filters});if(table===failTable)throw Error('fixture source unavailable');return rows[table]||[];};
  const rpc=async(name,params)=>{calls.push({rpc:name,params});return {ok:true,replayed:false};};
  return {service:new ProactiveCoachService({request,rpc,disclosure:verified,now:()=>now}),calls};
}

test('PC30 deterministic commitment signal exposes source/window and stays within the 12 item cap',async()=>{
  const due={id:901,person_id:71,interaction_id:44,commitment_type:'MUTUAL',content:'【系统测试·勿联系】虚构承诺',due_at:'2026-10-18T04:00:00.000Z',status:'open',updated_at:'2026-10-16T04:00:00.000Z'};
  const f=fixture({commitments:[due]});
  const result=await f.service.list('fictional-reviewer');
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].source,'public.commitments#901');
  assert.equal(result.candidates[0].personId,71);
  assert.equal(result.candidates[0].sourceRow,undefined);
  assert.equal(result.candidates[0].canCreateAction,true);
  assert.equal(result.candidates[0].actionDraft.descriptionKey,'pc30_action_commitment_description');
  assert.match(result.candidates[0].actionDraft.templateArgs.candidateKey,/^[0-9a-f-]{36}$/);
  assert.equal(result.limit,12);
});

test('PC30 suppresses deleted Persons, already completed follow-up, and duplicate open Actions',async()=>{
  const commitment={id:902,person_id:71,interaction_id:45,content:'fictional',due_at:'2026-10-18T04:00:00Z',status:'open'};
  const f=fixture({commitments:[commitment],people:[{id:71,display_name:'[CRM_TEST_ONLY] Fictional Person',deleted_at:null}],
    actions:[{id:903,person_id:71,interaction_id:45,status:'open',description:''}]});
  assert.equal((await f.service.list('fictional-reviewer')).candidates.length,0);
  const deleted=fixture({commitments:[commitment],people:[]});
  assert.equal((await deleted.service.list('fictional-reviewer')).candidates.length,0);
});

test('PC30 deferrals persist across reads and reappear with their decision after expiry',async()=>{
  const commitment={id:906,person_id:71,content:'【系统测试·勿联系】虚构承诺',due_at:'2026-10-18T04:00:00Z',status:'open',updated_at:'2026-10-16T04:00:00Z'};
  const key=candidateKey('fictional-reviewer','commitment_due',71,906,`${commitment.updated_at}|${commitment.due_at}|${commitment.status}`);
  const active=fixture({commitments:[commitment],decisions:[{candidate_key:key,decision:'deferred',snooze_until:'2026-10-20T04:00:00Z'}]});
  assert.equal((await active.service.list('fictional-reviewer')).candidates.length,0);
  const expired=fixture({commitments:[commitment],decisions:[{candidate_key:key,decision:'deferred',snooze_until:'2026-10-17T03:00:00Z'}]});
  const result=await expired.service.list('fictional-reviewer');
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].previouslyDeferred,true);
});

test('PC30 refuses candidate generation when a source read fails',async()=>{
  const f=fixture({failTable:'activities'});
  await assert.rejects(f.service.list('fictional-reviewer'),/fixture source unavailable/);
});

test('PC30 detects recent relationship edits and event/recruit follow-up gaps while requiring evidence',async()=>{
  const f=fixture({people:[{id:71,display_name:'【系统测试·勿联系】虚构人物 A',deleted_at:null},
      {id:72,display_name:'【系统测试·勿联系】虚构人物 B',deleted_at:null}],
    actions:[],commitments:[]});
  const relationship={id:910,from_person_id:71,to_person_id:72,relationship_type:'同事',strength:'medium',importance:4,
    status:'confirmed',updated_at:'2026-10-16T04:00:00Z',deleted_at:null};
  const activity={id:911,name:'【系统测试·勿联系】虚构活动',status:'ended',activity_date:'2026-10-14T04:00:00Z',
    updated_at:'2026-10-15T04:00:00Z',deleted_at:null};
  const participant={id:912,activity_id:911,canonical_person_id:71,person_id:null,person_type:'person',
    followup_status:'pending',updated_at:'2026-10-15T04:00:00Z',deleted_at:null};
  const recruit={id:913,person_id:72,customer_id:null,stage:'互动暖客',stage_changed_at:'2026-10-01T04:00:00Z',
    created_at:'2026-09-01T04:00:00Z',updated_at:'2026-10-01T04:00:00Z',deleted_at:null,next_action:'【系统测试·勿联系】核实兴趣'};
  f.service.request=async(table,method,filters)=>{
    f.calls.push({table,method,filters});
    if(table==='relationships')return [relationship];
    if(table==='activities')return [activity];
    if(table==='activity_participants')return [participant];
    if(table==='recruit_candidates')return [recruit];
    return (table==='crm_proactive_coach_decisions'?[]:({persons:[{id:71,display_name:'【系统测试·勿联系】虚构人物 A'},
      {id:72,display_name:'【系统测试·勿联系】虚构人物 B'}]}[table]||[]));
  };
  const result=await f.service.list('fictional-reviewer');
  assert.deepEqual(new Set(result.candidates.map(c=>c.type)),new Set(['relationship_changed','activity_followup','recruit_stagnation']));
  assert.equal(result.candidates.some(c=>c.type==='relationship_decay'),false,'no adequate cadence must not create a decay signal');
  assert.equal(result.candidates.find(c=>c.type==='activity_followup').source,'public.activity_participants#912');
  assert.equal(result.candidates.find(c=>c.type==='recruit_stagnation').source,'public.recruit_candidates#913');
});

test('PC30 test-data/unverified disclosure blocks Action creation but still permits review',async()=>{
  const due={id:904,person_id:71,content:'【系统测试·勿联系】虚构承诺',due_at:'2026-10-18T04:00:00Z',status:'open'};
  const f=fixture({commitments:[due]});
  f.service.disclosure=async()=>({status:'unverified',containsTestData:null,recordCount:null,sources:[]});
  const candidate=(await f.service.list('fictional-reviewer')).candidates[0];
  assert.equal(candidate.canCreateAction,false);
  assert.equal(candidate.testData.status,'unverified');
});

test('PC30 stores only bounded decision input and binds it to authenticated operator',async()=>{
  const f=fixture();
  const key=candidateKey('fictional-reviewer','commitment_due',71,905,'v1');
  assert.match(key,/^[0-9a-f-]{36}$/);
  await f.service.decide({candidateKey:key,personId:'71',sourceType:'commitment_due',sourceId:'905',decision:'deferred',snoozeDays:7},'fictional-reviewer');
  assert.deepEqual(f.calls.find(c=>c.rpc).params,{p_actor_uid:'fictional-reviewer',p_candidate_key:key,p_person_id:71,
    p_source_type:'commitment_due',p_source_id:905,p_decision:'deferred',p_snooze_days:7,p_action_id:null});
  await assert.rejects(f.service.decide({candidateKey:key,personId:'71',sourceType:'commitment_due',sourceId:'905',decision:'rejected',uid:'forged'},'fictional-reviewer'));
});
