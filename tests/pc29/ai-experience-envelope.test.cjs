'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { aiExperienceInput, createMain } = require('../../cloudfunctions/assistant/index');
const service = require('../../cloudfunctions/assistant/ai-experience-service');

const transport = { requestId:'cloud-runtime-fixture', cloudbaseContext:{ runtime:true }, userInfo:{ runtime:true } };
const base = { action:'aiExperience' };
const uuid = '00000000-0000-4000-8000-000000000001';

test('AI Experience reads project CloudBase transport fields before strict validation', async () => {
  const data = {
    list: async () => ({ tasks:[], results:[], decisions:[], outcomes:[], learnings:[], metrics:{} }),
    targets: async () => ({ actions:[], opportunities:[], activities:[], recruitFollowups:[] }),
  };
  for (const operation of ['list','targets']) {
    const input = aiExperienceInput({ ...base, operation, ...transport });
    assert.deepEqual(input, { ...base, operation });
    const result = await service.runAiExperience(input, 'fictional-reviewer', { data });
    assert.equal(result.ok, true);
  }
});

test('AI Experience write operations keep their exact business payload and discard only transport fields', () => {
  const cases = [
    { operation:'decide', eventId:uuid, aiResultId:50, decision:'rejected', reason:'Fictional evidence is insufficient', editDelta:null },
    { operation:'outcome', idempotencyKey:uuid, targetType:'activity', targetId:11, aiResultId:50,
      result:'Fictional review only', occurredAt:'2026-10-22T09:00:00.000Z', evidence:'public.ai_results#50' },
    { operation:'learning', candidateKey:uuid, payload:{ sourceResultIds:[50,51], primaryResultId:51,
      situation:'Fictional review', learning:'Check activity-local evidence', scope:'Fictional Activity #11' } },
    { operation:'confirmLearning', learningId:7, decision:'Fictional evidence checked' },
  ];
  for (const item of cases) {
    const business = { ...base, ...item };
    assert.deepEqual(aiExperienceInput({ ...business, ...transport }), business);
  }
});

test('AI Experience rejects forged operator, cross-operation fields and unknown operations', () => {
  const list = { ...base, operation:'list' };
  for (const extra of [{actorUid:'forged'}, {uid:'forged'}, {aiResultId:50},
    {targetId:11}, {reason:'unexpected'}, {confirmed:true}, {query:'unexpected'}]) {
    assert.equal(aiExperienceInput({ ...list, ...transport, ...extra }), null);
  }
  assert.equal(aiExperienceInput({ ...base, operation:'decide', targetId:11, ...transport }), null);
  assert.equal(aiExperienceInput({ ...base, operation:'toString', ...transport }), null);
  assert.equal(aiExperienceInput([base]), null);
});

test('authenticated assistant route forwards projected request and rejects forged business input', async () => {
  const original = service.runAiExperience;
  const observed = [];
  service.runAiExperience = async (input, actorUid) => {
    observed.push({ input, actorUid });
    return { ok:true, tasks:[], results:[] };
  };
  try {
    const main = createMain(async () => ({ uid:'fictional-reviewer', isAnonymous:false }));
    const result = await main({ ...base, operation:'list', ...transport });
    assert.equal(result.ok, true);
    assert.deepEqual(observed, [{ input:{ ...base, operation:'list' }, actorUid:'fictional-reviewer' }]);
    const denied = await main({ ...base, operation:'list', actorUid:'forged', ...transport });
    assert.equal(denied.error.code, 'INVALID_INPUT');
    assert.equal(observed.length, 1);
    const anonymous = createMain(async () => ({ uid:'anonymous', isAnonymous:true }));
    assert.equal((await anonymous({ ...base, operation:'list', ...transport })).error.code, 'UNAUTHORIZED');
  } finally { service.runAiExperience = original; }
});
