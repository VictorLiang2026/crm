'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../../cloudfunctions/today_coach');
const dbPath = require.resolve(path.join(root, 'db.js'));
let reads = 0;
let caller = null;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  app: { auth: () => ({ getUserInfo: () => caller }) },
  rdb: { from: () => { reads++; throw new Error('No database request expected'); } },
  generateText: async () => { throw new Error('No AI request expected'); },
  extractJson: () => null, assertOk: x => x, nowIso: () => '2026-09-28T00:00:00Z',
} };
const coach = require(path.join(root, 'index.js'));
const facts = require(path.join(root, 'action-facts.js'));

const base = {
  customers: [{ Id: 10, customer_stage: '需求', sales_priority: 'A' }],
  followups: [{ customer_id: 10, followup_date: '2026-09-25', followup_notes: '已记录' }],
  recruitFollowups: [], opportunities: [{ id: 31, customer_id: 10, status: '进行中' }],
  actions: [{ action_id: 'opportunity-31', action_type: 'opportunity', person_type: 'customer',
    person_id: 10, person_name: '测试人', title: '数据库行动', next_action: '数据库行动',
    action_date: '2026-09-28', priority: 'A', source: 'opportunities', status: 'today',
    stage: '需求', days_until: 0, last_followup_date: '2026-09-25' }],
};
const ledger = { rows: [{ id: 5, person_id: 99, opportunity_id: 31, action_type: 'call',
  title: '数据库行动', due_at: '2026-09-28T00:00:00+08:00', priority: 'high',
  status: 'open', source: 'manual', urgency_score: 90, impact_score: 80,
  confidence_score: 70, effort_score: 20, updated_at: '2026-09-27T00:00:00Z' }],
persons: [{ id: 99, display_name: '测试人', legacy_customer_id: 10, deleted_at: null }] };

test('unauthenticated request fails before any database or AI work', async () => {
  assert.deepEqual(await coach.main({ action: 'generate' }), { error: 'UNAUTHORIZED' });
  caller = { uid: 'anonymous-test-user', isAnonymous: true };
  assert.deepEqual(await coach.main({ action: 'generate' }), { error: 'UNAUTHORIZED' });
  caller = null;
  assert.equal(reads, 0);
});

test('open Action wins over the linked legacy opportunity and has six rule dimensions', () => {
  const candidates = coach.__test.buildActionCandidates(base, {}, '2026-09-28', ledger);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].action_id, 'action-5');
  assert.equal(candidates[0].person_type, 'person');
  assert.equal(candidates[0].action_date, '2026-09-28');
  assert.deepEqual(Object.keys(candidates[0].dimensions).sort(),
    ['urgency', 'impact', 'confidence', 'effort', 'relationship_value', 'opportunity_value'].sort());
});

test('AI cannot change the database action, deadline, objective, confidence or evidence', () => {
  const [candidate] = coach.__test.buildActionCandidates(base, {}, '2026-09-28', ledger);
  const [pick] = coach.__test.normTodayFive({ picks: [{ ref: 1, tier: 'must_do',
    action: 'AI fabricated action', suggested_date: '2035-01-01', goal: 'AI fabricated goal',
    evidence: ['AI fabricated fact'], confidence: 'high', reason: '沟通排序建议',
    channel: '电话', script: '您好，方便沟通吗？' }] }, [candidate], '2026-09-28');
  assert.equal(pick.action, '数据库行动');
  assert.equal(pick.what_to_do, '数据库行动');
  assert.equal(pick.action_date, '2026-09-28');
  assert.equal(pick.suggested_date, '2026-09-28');
  assert.equal(pick.goal, '完成已记录行动并确认下一步');
  assert.equal(pick.confidence, 'medium');
  assert.ok(!pick.evidence.includes('AI fabricated fact'));
  for (const key of ['why_now', 'what_to_do', 'expected_objective', 'preparation', 'risk']) {
    assert.ok(pick[key], `${key} is required`);
  }
  assert.equal(coach.__test.todayFiveToLegacy([pick])[0].type, 'person');
});

test('Action API stays on public with a server-only bearer token and filters open rows', async () => {
  const requests = [];
  const response = async (url, options) => {
    requests.push({ url: String(url), headers: options.headers });
    return { ok: true, json: async () => requests.length === 1 ? ledger.rows : ledger.persons };
  };
  const result = await facts.readOpenActions({ env: 'crm-d1gkae8ddc930d151', key: 'test-only', fetchImpl: response });
  assert.equal(result.rows.length, 1);
  assert.equal(result.persons.length, 1);
  assert.match(requests[0].url, /\/v1\/rdb\/rest\/actions/);
  assert.match(requests[0].url, /status=in.%28open%2Cin_progress%29/);
  assert.equal(requests[0].headers['Accept-Profile'], 'public');
  assert.equal(requests[0].headers.Authorization, 'Bearer test-only');
  assert.notEqual(facts.fingerprint(ledger.rows), facts.fingerprint([{...ledger.rows[0], updated_at: '2026-09-28'}]));
});
