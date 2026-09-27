'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { quickCaptureV2, normalizeDraft } = require('../../cloudfunctions/ai_parse/quick-capture-v2');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '@cloudbase/node-sdk') return { init: () => ({ auth: () => ({ getUserInfo: () => ({ uid: '' }) }) }) };
  return originalLoad.call(this, request, parent, isMain);
};
const { createService, main } = require('../../cloudfunctions/person_360/index.js');
Module._load = originalLoad;

const draft = {
  person_name: '张玮（电信）',
  interaction: { type: '微信', date: '2026-09-27', channel: '微信', summary: '约好下周沟通' },
  facts: ['孩子明年升学'], signals: ['咨询过教育金'],
  opportunity_candidates: ['可能需要教育金方案'], action_candidates: ['下周联系'],
  commitment_candidates: ['约定下周沟通'], evidence: ['孩子明年升学'],
};

test('V2 parsing only returns bounded, separate candidates and never writes', async () => {
  let calls = 0;
  const result = await quickCaptureV2({ text: '原话' }, {
    today: '2026-09-27', extractJson: JSON.parse,
    generateText: async () => { calls++; return { text: JSON.stringify(draft) }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.preview.personName, '张玮（电信）');
  assert.deepEqual(result.preview.facts, ['孩子明年升学']);
  assert.deepEqual(result.preview.signals, ['咨询过教育金']);
  assert.deepEqual(result.preview.opportunityCandidates, ['可能需要教育金方案']);
  assert.equal('confirmed' in result.preview, false);
  assert.throws(() => normalizeDraft({ ...draft, facts: [42] }), /Invalid facts/);
  assert.throws(() => normalizeDraft({ ...draft, interaction: { ...draft.interaction, date: '2026-02-30' } }), /Invalid interaction date/);
});

function fixture() {
  const calls = [];
  const person = { id: 11, display_name: '张玮（电信）', name_key: '张玮', legacy_customer_id: 101 };
  const service = createService({
    request: async (table, method, filters) => {
      calls.push({ table, method, filters });
      assert.equal(table, 'persons'); assert.equal(method, 'GET');
      return filters.name_key === 'eq.张玮' ? [person] : [];
    },
    rpc: async (name, body) => { calls.push({ name, body }); return { interactionId: 19, contextItemCount: 2 }; },
  });
  const payload = { personId: '11', selectedDisplayName: person.display_name, confirmed: true,
    interaction: { type: '微信', at: '2026-09-27T12:00:00+08:00', channel: '微信',
      summary: '人工核对摘要', rawNote: '原话' }, facts: ['人工编辑事实'], signals: ['观察线索'],
    opportunityCandidates: ['不应写入'] };
  return { calls, service, payload };
}

test('identity resolution never auto-selects a Person', async () => {
  const { service } = fixture();
  const result = await service.resolveQuickCaptureName('张玮（电信）');
  assert.equal(result.status, 'confirm_existing');
  assert.equal(result.selectedPersonId, null);
});

test('confirmation and exact existing Person are required before RPC', async () => {
  const { calls, service, payload } = fixture();
  await assert.rejects(service.commitQuickCaptureV2({ ...payload, confirmed: false }, 'test-uid'), /Human confirmation/);
  await assert.rejects(service.commitQuickCaptureV2({ ...payload, personId: '12' }, 'test-uid'), /Selected Person/);
  await assert.rejects(service.commitQuickCaptureV2({ ...payload, selectedDisplayName: '错误姓名' }, 'test-uid'), /Selected Person/);
  await assert.rejects(service.commitQuickCaptureV2({ ...payload, facts: ['x'.repeat(501)] }, 'test-uid'), /Invalid Context/);
  assert.equal(calls.some(call => call.name), false);
});

test('confirmed V2 payload passes only Interaction, Fact and Signal to restricted RPC', async () => {
  const { calls, service, payload } = fixture();
  const saved = await service.commitQuickCaptureV2(payload, 'test-uid');
  assert.equal(saved.interactionId, 19);
  const rpc = calls.find(call => call.name === 'quick_capture_v2_commit');
  assert.equal(rpc.body.p_actor_uid, 'test-uid');
  assert.deepEqual(rpc.body.p_facts, ['人工编辑事实']);
  assert.deepEqual(rpc.body.p_signals, ['观察线索']);
  assert.equal('opportunityCandidates' in rpc.body, false);
});

test('anonymous call is denied before any V2 database access', async () => {
  assert.deepEqual(await main({ action: 'commitQuickCaptureV2', data: {} }), { error: 'UNAUTHORIZED' });
});
