'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let uid = '';
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '@cloudbase/node-sdk') {
    return { init: () => ({ auth: () => ({ getUserInfo: () => ({ uid }) }) }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { main } = require('../../cloudfunctions/person_360/index.js');
Module._load = originalLoad;

const oldEnv = process.env.TCB_ENV;
const oldKey = process.env.CRM_PERSON360_DB_API_KEY;
const oldFetch = global.fetch;
process.env.TCB_ENV = 'crm-test';
process.env.CRM_PERSON360_DB_API_KEY = 'test-only-key';
const calls = [];
global.fetch = async (url, options) => {
  const u = new URL(url);
  const table = u.pathname.split('/').pop();
  calls.push({ table, method: options.method, filters: Object.fromEntries(u.searchParams), body: options.body });
  assert.equal(options.headers['Accept-Profile'], 'public');
  let rows = [];
  if (table === 'persons') rows = [{ id: 11, legacy_customer_id: 101, display_name: '测试人物' }];
  if (table === 'commitments' && u.searchParams.get('due_at').startsWith('gte.')) rows = [{
    id: 17, person_id: 11, commitment_type: 'I_PROMISED', content: '[CRM_TEST_ONLY]承诺',
    due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), status: 'open', source: 'manual',
  }];
  if (table === 'followups') rows = [{ Id: 5, followup_date: '2026-09-10', interaction_summary: '旧跟进' }];
  if (table === 'recruit_candidates') rows = [{ id: 7, person_id: 11, stage: '面谈',
    motivation: '了解工作', concerns: '时间安排', potential_score: 4,
    career_plan: '转型', next_action: '再次沟通', next_action_date: '2026-10-01' }];
  if (table === 'recruit_followups') rows = [{ id: 8, candidate_id: 7,
    followup_date: '2026-09-29', interaction_summary: '明确职业意向', contact_method: '微信' }];
  if (table === 'interactions' && options.method === 'POST') rows = [{ id: 9, ...JSON.parse(options.body) }];
  return { ok: true, text: async () => JSON.stringify(rows) };
};
test.after(() => {
  global.fetch = oldFetch;
  if (oldEnv === undefined) delete process.env.TCB_ENV; else process.env.TCB_ENV = oldEnv;
  if (oldKey === undefined) delete process.env.CRM_PERSON360_DB_API_KEY;
  else process.env.CRM_PERSON360_DB_API_KEY = oldKey;
});

test('new actions reject missing login before database requests', async () => {
  uid = '';
  calls.length = 0;
  assert.deepEqual(await main({ action: 'listInteractions', personId: 11 }), { error: 'UNAUTHORIZED' });
  assert.deepEqual(await main({ action: 'listRecruitContext', personId: 11 }), { error: 'UNAUTHORIZED' });
  assert.deepEqual(await main({ action: 'createInteraction', personId: 11, data: {} }), { error: 'UNAUTHORIZED' });
  assert.deepEqual(await main({ action: 'recordActivityInteraction', data: {} }), { error: 'UNAUTHORIZED' });
  assert.deepEqual(await main({ action: 'listDueCommitments' }), { error: 'UNAUTHORIZED' });
  assert.deepEqual(await main({ action: 'getRelationshipDecay', personId: 11 }), { error: 'UNAUTHORIZED' });
  assert.equal(calls.length, 0);
});

test('relationship decay endpoint only reads bounded public sources after login', async () => {
  uid = 'test-uid';
  calls.length = 0;
  const result = await main({ action: 'getRelationshipDecay', personId: 11 });
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.candidate, false);
  assert.equal(result.persisted, false);
  assert.match(result.why, /关系强度/);
  assert.ok(calls.some(call => call.table === 'context_items' && call.filters.limit === '30'));
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('listDueCommitments uses read-only public queries after login', async () => {
  uid = 'test-uid';
  calls.length = 0;
  const result = await main({ action: 'listDueCommitments' });
  assert.equal(result.dueSoon.length, 1);
  assert.equal(result.dueSoon[0].person_name, '测试人物');
  assert.deepEqual(calls.map(call => call.table), ['commitments', 'commitments', 'persons']);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('listInteractions reads legacy followups through the authenticated function', async () => {
  uid = 'test-uid';
  calls.length = 0;
  const result = await main({ action: 'listInteractions', personId: 11, limit: 10 });
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map(row => row.source_type), ['recruit_followups', 'followups']);
  assert.equal(result.rows[0].summary, '明确职业意向');
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('Recruit panel reads only this Person active candidate and recent followups', async () => {
  uid = 'test-uid';
  calls.length = 0;
  const result = await main({ action: 'listRecruitContext', personId: 11 });
  assert.equal(result.rows[0].stage, '面谈');
  assert.equal(result.rows[0].recentFollowups[0].summary, '明确职业意向');
  assert.equal(calls.find(call => call.table === 'recruit_candidates').filters.person_id, 'eq.11');
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('createInteraction writes only the new ledger and records the caller UID', async () => {
  uid = 'test-uid';
  calls.length = 0;
  const result = await main({ action: 'createInteraction', personId: 11, data: {
    interaction_type: 'meeting', interaction_at: '2026-09-26T21:00:00+08:00',
    summary: '明确标记的测试录入',
  } });
  assert.equal(result.interaction.source_type, 'manual');
  const writes = calls.filter(call => call.method !== 'GET');
  assert.deepEqual(writes.map(call => call.table), ['interactions']);
  assert.equal(JSON.parse(writes[0].body).created_by_uid, 'test-uid');
});

test('existing Person 360 get action remains compatible', async () => {
  uid = 'test-uid';
  calls.length = 0;
  const result = await main({ action: 'get', personId: 11 });
  assert.equal(result.person.display_name, '测试人物');
  assert.equal(result.household, null);
  assert.deepEqual(result.members, []);
});
