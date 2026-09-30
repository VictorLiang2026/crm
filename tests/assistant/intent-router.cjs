'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMain } = require('../../cloudfunctions/assistant');
const { defaultRegistry } = require('../../cloudfunctions/_shared/skill-registry');

const authenticated = createMain(() => ({ uid: 'test-user', isAnonymous: false }));

const requests = [
  { intent: 'search', input: { query: '保障' }, route: 'search.none', skill: 'ai_search' },
  { intent: 'summarize', subject: { type: 'person', id: 7 }, input: {},
    route: 'summarize.person', skill: 'person_summary' },
  { intent: 'prepare', subject: { type: 'person', id: 7 }, input: {},
    route: 'prepare.person', skill: 'meeting_prep' },
  { intent: 'prepare', subject: { type: 'activity', id: 8 }, input: {},
    route: 'prepare.activity', skill: 'activity_prepare' },
  { intent: 'analyze', subject: { type: 'opportunity', id: 9 }, input: {},
    route: 'analyze.opportunity', skill: 'opportunity_analysis' },
  { intent: 'analyze', subject: { type: 'activity', id: 8 }, input: {},
    route: 'analyze.activity', skill: 'activity_review' },
  { intent: 'plan', subject: { type: 'day', id: '2026-09-30' }, input: {},
    route: 'plan.day', skill: 'today_coach' },
  { intent: 'create_candidate', subject: { type: 'person', id: 7 },
    input: { candidateType: 'action', draft: { title: '[CRM_TEST_ONLY] 联系' } },
    route: 'create_candidate.person', skill: null },
  { intent: 'update_candidate', input: { candidateType: 'opportunity',
    candidateId: 'draft-1', changes: { status: '待核实' } },
    route: 'update_candidate.none', skill: null },
];

test('all seven intents and supported subject variants return a non-executing route', async () => {
  for (const { route, skill, ...request } of requests) {
    const response = await authenticated(request);
    assert.equal(response.ok, true, route);
    assert.equal(response.status, 'routed');
    assert.equal(response.route.key, route);
    assert.equal(response.route.skill, skill);
    assert.deepEqual(response.execution, { performed: false, modelCalled: false,
      businessDataRead: false, businessDataWritten: false });
    if (skill) {
      const definition = defaultRegistry.get(skill);
      assert.ok(definition, skill);
      assert.equal(response.route.capability, definition.capability);
      assert.equal(response.route.confirmationLevel, definition.confirmationLevel);
    } else assert.equal(response.route.confirmationLevel, 'confirm_before_write');
  }
});

test('login gate runs before parsing and rejects anonymous or missing identity', async () => {
  const invalid = { intent: 'unknown', input: {} };
  for (const identity of [null, { uid: '', isAnonymous: false },
    { uid: 'anonymous', isAnonymous: true }]) {
    const response = await createMain(() => identity)(invalid);
    assert.equal(response.error.code, 'UNAUTHORIZED');
  }
  const unavailable = await createMain(() => { throw new Error('secret'); })(invalid);
  assert.equal(unavailable.error.code, 'UNAUTHORIZED');
  assert.equal(JSON.stringify(unavailable).includes('secret'), false);
});

test('unknown intents, subject mismatches and invalid candidate payloads fail closed', async () => {
  const cases = [
    { intent: 'chat', input: { query: 'hi' } },
    { intent: 'summarize', subject: { type: 'day', id: '2026-09-30' }, input: {} },
    { intent: 'plan', subject: { type: 'day', id: '2026-02-30' }, input: {} },
    { intent: 'search', input: { query: '' } },
    { intent: 'search', input: { query: 'x', sql: 'select *' } },
    { intent: 'create_candidate', input: { candidateType: 'action', draft: {} } },
    { intent: 'create_candidate', input: { candidateType: 'action', draft: { title: 'x'.repeat(9000) } } },
    { intent: 'update_candidate', input: { candidateType: 'action', candidateId: '../bad',
      changes: { title: 'x' } } },
    { intent: 'update_candidate', input: { candidateType: 'action', candidateId: 'draft-1',
      changes: JSON.parse('{"__proto__":{"admin":true}}') } },
  ];
  for (const request of cases) {
    const response = await authenticated(request);
    assert.equal(response.ok, false, JSON.stringify(request).slice(0, 100));
    assert.ok(['INVALID_INTENT', 'INVALID_INPUT', 'INVALID_SUBJECT'].includes(response.error.code));
  }
});

test('response never repeats user notes or claims an execution happened', async () => {
  const sensitive = '[CRM_TEST_ONLY] private note';
  const response = await authenticated({ intent: 'create_candidate',
    input: { candidateType: 'fact', draft: { content: sensitive } } });
  assert.equal(response.ok, true);
  assert.equal(JSON.stringify(response).includes(sensitive), false);
  assert.equal(response.route.confirmationLevel, 'confirm_before_write');
});

test('CloudBase transport metadata does not invalidate a declared route', async () => {
  const response = await authenticated({ intent: 'search', input: { query: '保障' },
    userInfo: { uid: 'platform-value' }, requestId: 'platform-request' });
  assert.equal(response.ok, true);
  assert.equal(response.route.key, 'search.none');
  assert.equal(JSON.stringify(response).includes('platform-value'), false);
});
