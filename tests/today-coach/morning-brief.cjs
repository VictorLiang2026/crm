'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readMorningFacts, buildMorningSections, enhanceGuidance } =
  require('../../cloudfunctions/today_coach/morning-brief');

const today = '2026-10-01';
const data = { customers: [{ Id: 10, customer_name: '[CRM_TEST_ONLY]客户甲' }],
  activities: [{ id: 40, name: '[CRM_TEST_ONLY]近期活动', activity_date: '2026-10-03', status: 'preparing' },
    { id: 41, name: '已取消活动', activity_date: '2026-10-03', status: 'cancelled' }] };
const actions = [{ action_id: 'action-5', person_type: 'person', person_id: 99,
  person_name: '[CRM_TEST_ONLY]客户甲', title: '[CRM_TEST_ONLY]核对方案',
  action_date: '2026-10-01', status: 'today', score: 92, canonical: true },
  { action_id: 'followup-10', person_type: 'customer', person_id: 10,
    person_name: '[CRM_TEST_ONLY]客户甲', title: '已逾期跟进',
    action_date: '2026-09-30', status: 'overdue', score: 80 }];
const facts = {
  persons: [{ id: 99, display_name: '[CRM_TEST_ONLY]客户甲', deleted_at: null }],
  overdue: [{ id: 50, person_id: 99, commitment_type: 'I_PROMISED',
    content: '[CRM_TEST_ONLY]答复客户', due_at: '2026-09-30T08:00:00+08:00' }],
  dueSoon: [{ id: 51, person_id: 99, commitment_type: 'MUTUAL',
    content: '[CRM_TEST_ONLY]约定会面', due_at: '2026-10-02T08:00:00+08:00' }],
  opportunities: [{ id: 60, person_id: 99, opportunity_type: 'insurance',
    status: '沟通', next_action: '核实已有保障' }],
  candidates: [{ id: 70, person_id: 99, draft: { opportunity_type: 'service',
    reason: '已记录需求，待人工核实' }, status: 'draft' }], hasMore: {},
};

test('all seven sections use bounded database facts and keep candidates separate from formal opportunities', () => {
  const result = buildMorningSections({ data, actions, facts, today });
  assert.deepEqual(Object.keys(result).slice(0, 7), ['morningBrief', 'topActions', 'commitments',
    'upcoming', 'risk', 'opportunities', 'needConfirmation']);
  assert.equal(result.topActions[0].source, 'public.actions#5');
  assert.equal(result.commitments.overdue[0].source, 'public.commitments#50');
  assert.equal(result.upcoming.length, 1);
  assert.equal(result.opportunities[0].source, 'public.opportunities#60');
  assert.equal(result.needConfirmation[0].source, 'public.opportunity_candidates#70');
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.risk.length, 2);
});

test('AI output can only select a preapproved advisory and cannot alter facts', async () => {
  const result = buildMorningSections({ data, actions, facts, today });
  const before = JSON.stringify(result.topActions);
  await enhanceGuidance(result, async () => ({ text: '{"focus":"opportunity_review","new_fact":"invented"}' }), JSON.parse);
  assert.equal(result.morningBrief.guidanceSource, 'rule'); // overdue commitment must win
  await enhanceGuidance(result, async () => ({ text: '{"focus":"overdue_commitment","new_fact":"invented"}' }), JSON.parse);
  assert.equal(result.morningBrief.guidanceSource, 'ai');
  assert.equal(JSON.stringify(result.topActions), before);
  assert.doesNotMatch(JSON.stringify(result), /invented/);
});

test('read adapter stays on public, uses service key only, and separates overdue from due soon', async () => {
  const seen = [];
  const rows = {
    commitments: [facts.overdue[0]], opportunities: [facts.opportunities[0]],
    opportunity_candidates: [facts.candidates[0]], persons: facts.persons,
  };
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    seen.push({ parsed, options });
    const table = parsed.pathname.split('/').pop();
    const value = table === 'commitments' && parsed.searchParams.has('and') ? facts.dueSoon : rows[table];
    return { ok: true, json: async () => value };
  };
  const result = await readMorningFacts({ env: 'crm-test123', key: 'fixture-only', today, fetchImpl });
  assert.equal(result.overdue.length, 1);
  assert.equal(result.dueSoon.length, 1);
  assert.equal(result.persons.length, 1);
  assert.equal(seen.length, 5);
  for (const { parsed, options } of seen) {
    assert.match(parsed.pathname, /^\/v1\/rdb\/rest\/(commitments|opportunities|opportunity_candidates|persons)$/);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['Accept-Profile'], 'public');
    assert.equal(options.headers.Authorization, 'Bearer fixture-only');
    assert.ok(Number(parsed.searchParams.get('limit')) <= 100);
    assert.doesNotMatch(parsed.pathname, /\/pr_/);
  }
});

test('missing service key fails before a database request', async () => {
  await assert.rejects(readMorningFacts({ env: 'crm-test123', key: '', today,
    fetchImpl: () => { throw new Error('must not fetch'); } }), /not configured/);
});
