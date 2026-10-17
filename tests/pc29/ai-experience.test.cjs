'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runAiExperience, validateDecision, validateOutcome, validateLearning, validateConfirmation } = require('../../cloudfunctions/assistant/ai-experience-service');
const { createAiExperienceData } = require('../../cloudfunctions/assistant/ai-experience-data');

const actor = 'fictional-reviewer';
const eventId = '00000000-0000-4000-8000-000000000001';
const candidateKey = '00000000-0000-4000-8000-000000000002';

test('PC29 decision validation requires rejection reason and modified delta', () => {
  assert.throws(() => validateDecision({ action:'aiExperience', operation:'decide', eventId, aiResultId:7,
    decision:'rejected', reason:null, editDelta:null }, actor));
  assert.throws(() => validateDecision({ action:'aiExperience', operation:'decide', eventId, aiResultId:7,
    decision:'modified', reason:null, editDelta:{} }, actor));
  assert.deepEqual(validateDecision({ action:'aiExperience', operation:'decide', eventId, aiResultId:7,
    decision:'modified', reason:'Changed the timing', editDelta:{before:{next:'Monday'},after:{next:'Friday'}} }, actor), {
    actorUid:actor,eventId,aiResultId:7,decision:'modified',reason:'Changed the timing',
    editDelta:{before:{next:'Monday'},after:{next:'Friday'}},
  });
  assert.throws(() => validateDecision({ action:'aiExperience', operation:'decide', eventId, aiResultId:7,
    decision:'accepted', reason:null, editDelta:{}, confirmed:true }, actor));
});

test('PC29 actual Outcome requires evidence and a timezone-aware occurrence time', () => {
  const input = { action:'aiExperience',operation:'outcome',idempotencyKey:eventId,targetType:'action',targetId:9,
    aiResultId:7,result:'[CRM_TEST_ONLY] Fictional follow-up result',occurredAt:'2026-10-17T09:00:00+08:00',
    evidence:'[CRM_TEST_ONLY] Fictional note only' };
  assert.equal(validateOutcome(input,actor).occurredAt,'2026-10-17T01:00:00.000Z');
  assert.throws(() => validateOutcome({...input,evidence:' '},actor));
  assert.throws(() => validateOutcome({...input,occurredAt:'2026-10-17'},actor));
  assert.throws(() => validateOutcome({...input,targetType:'customers'},actor));
  for (const targetType of ['opportunity','activity','recruit_followup'])
    assert.equal(validateOutcome({...input,targetType},actor).targetType,targetType);
});

test('PC29 Learning payload binds the primary result and counterexamples to selected sources', () => {
  const payload={sourceResultIds:[7,8],primaryResultId:7,situation:'[CRM_TEST_ONLY] fictional setting',
    recommendation:'[CRM_TEST_ONLY] fictional advice',actualAction:'[CRM_TEST_ONLY] fictional response',
    learning:'[CRM_TEST_ONLY] discuss verified needs first',scope:'fictional test cohort',confidence:0.7,counterexampleIds:[8]};
  assert.equal(validateLearning({action:'aiExperience',operation:'learning',candidateKey,payload},actor).payload.sourceResultIds.length,2);
  assert.throws(() => validateLearning({action:'aiExperience',operation:'learning',candidateKey,
    payload:{...payload,counterexampleIds:[99]}},actor));
  assert.throws(() => validateLearning({action:'aiExperience',operation:'learning',candidateKey,
    payload:{...payload,primaryResultId:99}},actor));
});

test('PC29 workflow derives identity server-side, calls bounded operations and rejects extra fields', async () => {
  const calls=[];
  const data={list:async()=>({tasks:[],results:[],decisions:[],outcomes:[],learnings:[],metrics:{windowDays:30}}),
    targets:async()=>({actions:[]}),decide:async input=>{calls.push(['decide',input]);return {eventId:input.eventId,replayed:false};},
    outcome:async input=>({outcomeId:11,replayed:false}),learning:async input=>({learningId:12,replayed:false}),
    confirmLearning:async input=>({learningId:input.learningId,confirmed:true,replayed:false})};
  const list=await runAiExperience({action:'aiExperience',operation:'list'},actor,{data});
  assert.equal(list.metrics.windowDays,30);
  const saved=await runAiExperience({action:'aiExperience',operation:'decide',eventId,aiResultId:7,
    decision:'accepted',reason:null,editDelta:null},actor,{data});
  assert.equal(saved.eventId,eventId);assert.equal(calls[0][1].actorUid,actor);
  await assert.rejects(runAiExperience({action:'aiExperience',operation:'list',uid:'forged'},actor,{data}));
  await assert.rejects(runAiExperience({action:'aiExperience',operation:'list'},'',{data}));
});

test('PC29 confirmation requires explicit reviewer text and a valid candidate ID', () => {
  assert.deepEqual(validateConfirmation({action:'aiExperience',operation:'confirmLearning',learningId:10,
    decision:'[CRM_TEST_ONLY] reviewed and confirmed'},actor),
  {actorUid:actor,learningId:10,decision:'[CRM_TEST_ONLY] reviewed and confirmed'});
  assert.throws(() => validateConfirmation({action:'aiExperience',operation:'confirmLearning',learningId:0,decision:'yes'},actor));
  assert.throws(() => validateConfirmation({action:'aiExperience',operation:'confirmLearning',learningId:10,decision:' '},actor));
});

test('PC29 server data adapter uses only public REST and keeps API credentials server-side', async () => {
  let observed;
  const data=createAiExperienceData({env:'crm-testfictional',key:'server-only-test-key',fetchImpl:async(url,init)=>{
    observed={url:String(url),init};return new Response(JSON.stringify({ok:true,eventId,replayed:false}),{status:200,
      headers:{'content-type':'application/json'}});
  }});
  const result=await data.decide({actorUid:actor,eventId,aiResultId:7,decision:'accepted',reason:null,editDelta:null});
  assert.equal(result.eventId,eventId);
  assert.match(observed.url,/\/v1\/rdb\/rest\/rpc\/crm_ai_experience_decide_v1/);
  assert.equal(observed.init.headers['Content-Profile'],'public');
  assert.equal(observed.init.headers.Authorization,'Bearer server-only-test-key');
  assert.equal(JSON.parse(observed.init.body).p_actor_uid,actor);
});
