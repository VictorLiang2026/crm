'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../cloudfunctions/ai_activity/activity-review-v2');
const { createPublicRdb } = require('../../cloudfunctions/ai_activity/public-rdb');

const claim = (text, sourceRefs) => ({ text, sourceRefs });
const source = (table, id, data) => ({ source: { schema: 'public', table, id: String(id) }, data });
const context = {
  activity: source('activities', 11, { id: 11, name: '测试活动', status: 'ended' }),
  participants: [source('activity_participants', 12, { id: 12, canonical_person_id: 7 })],
  tasks: [], persons: [source('persons', 7, { id: 7, display_name: '测试人物' })],
  activity_interactions: [source('interactions', 13, { id: 13, person_id: 7 })],
  recent_interactions: [], current_actions: [], open_opportunities: [], relationships: [],
};
const result = { summary: '仅供核实', whoMattered: [claim('值得联系', ['public.persons#7'])],
  whatChanged: [claim('无证据推断', [])], relationshipsImproved: [], signalsAppeared: [], opportunitiesAppeared: [],
  followUpPeople: [claim('虚构依据', ['public.persons#999'])],
  actionCandidates: [
    { personId: 7, title: '人工核实需求', reason: '活动沟通', sourceRefs: ['public.interactions#13'] },
    { personId: 8, title: '不应显示', reason: '身份未确认', sourceRefs: ['public.persons#7'] },
  ] };

test('new activity review requires a real login before context or AI access', async () => {
  let called = false;
  const response = await run({ activity_id: 11 }, { app: { auth: () => ({ getUserInfo: () => null }) },
    engine: { buildContext: () => { called = true; } } });
  assert.deepEqual(response, { error: 'UNAUTHORIZED' });
  assert.equal(called, false);
  const anonymous = await run({ activity_id: 11 }, { app: {
    auth: () => ({ getUserInfo: () => ({ uid: 'anonymous-uid', isAnonymous: true }) }),
  }, engine: { buildContext: () => { called = true; } } });
  assert.deepEqual(anonymous, { error: 'UNAUTHORIZED' });
  assert.equal(called, false);
});

test('review uses Gateway, checks the activity state and emits only sourced Person candidates', async () => {
  const calls = [];
  const app = { auth: () => ({ getUserInfo: () => ({ uid: 'test-uid', isAnonymous: false }) }) };
  const engine = { buildContext: async request => {
    calls.push(['context', request]);
    return { context, context_snapshot: { ...context, _context: { recipe: 'activity_review' } } };
  } };
  const gateway = { runAITask: async request => {
    calls.push(['gateway', request]);
    return { taskId: 101, resultId: 102, result };
  } };
  const response = await run({ activity_id: '11' }, { app, rdb: {}, engine, gateway });
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1].skill, 'activity_review');
  assert.equal(calls[1][1].context.activity.source.schema, 'public');
  assert.equal(response.review.actionCandidates.length, 1);
  assert.equal(response.review.actionCandidates[0].personName, '测试人物');
  assert.equal(response.review.followUpPeople.length, 0);
  assert.equal(response.review.whatChanged.length, 0);
  assert.equal(response.discarded_unsupported_items, 3);
  assert.equal(response.requires_confirmation, true);
  assert.equal(response.business_data_written, false);
});

test('server-only adapter restricts schema, tables and business writes', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method, profile: options.headers['Accept-Profile'] });
    return { ok: true, text: async () => '[{"id":1}]' };
  };
  const rdb = createPublicRdb({ env: 'crm-test123', key: 'test-secret', fetchImpl });
  await rdb.from('persons').select('id,display_name').in('id', [7, 8]).limit(20);
  await rdb.from('ai_tasks').insert({ task_type: 'test' }).select('id');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.profile === 'public' && !call.url.includes('test-secret')));
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].method, 'POST');
  await assert.rejects(async () => rdb.from('persons').update({ display_name: 'bad' }).eq('id', 7).select('id'),
    /read-only/);
  await assert.rejects(async () => rdb.from('forbidden').select('id'), /Invalid review table/);
});
