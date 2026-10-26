'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../cloudfunctions/ai_activity/activity-topic-recommend-v2');

function fixture(status = 'preparing') {
  const calls = [];
  const context = { activity: { data: { id: 21, status },
    source: { schema: 'public', table: 'activities', id: '21' } }, participants: [], tasks: [] };
  const engine = { buildContext: async input => { calls.push(input); return { context,
    context_snapshot: { ...context, _context: { recipe: 'activity_prepare', subjectId: 21 } } }; } };
  const rows = { activities: [{ id: 21, topic_ids: [1] }], activity_topics: [
    { id: 1, topic_name: 'Already selected', status: 'active' },
    { id: 2, topic_name: 'Health', status: 'active', use_count: 5 },
    { id: 3, topic_name: 'Finance', status: 'inactive' },
  ] };
  const rdb = { from(table) {
    calls.push({ table });
    let list = rows[table];
    return {
      select() { return this; },
      eq(field, value) { list = list.filter(row => row[field] === value); return this; },
      is() { return this; }, order() { return this; },
      limit(count) { list = list.slice(0, count); return this; },
      then(resolve, reject) { return Promise.resolve({ data: list }).then(resolve, reject); },
    };
  } };
  const gateway = { runAITask: async input => { calls.push(input); return { taskId: 91, resultId: 92,
    result: { recommendations: [
      { topicId: 2, score: 86, reason: 'Fits the audience' },
      { topicId: 999, score: 99, reason: 'Invented' },
      { topicId: 2, score: 75, reason: 'Duplicate' },
      { topicId: 1, score: 66, reason: 'Already selected' },
    ], note: 'Review before saving' } }; } };
  const app = { auth: () => ({ getUserInfo: () => ({ uid: 'operator', isAnonymous: false }) }) };
  return { calls, context, rows, engine, rdb, gateway, app };
}

test('topic advice filters selected, inactive, invented and duplicate IDs without business writes', async () => {
  const f = fixture();
  const result = await run({ activity_id: 21, language: 'en' }, f);
  assert.equal(result.business_data_written, false);
  assert.equal(result.requires_confirmation, true);
  assert.equal(result.result_id, 92);
  assert.deepEqual(result.recommendations.map(row => [row.topic_id, row.topic_name]), [[2, 'Health']]);
  const request = f.calls.find(call => call.skill === 'activity_topic_recommend');
  assert.equal(request.capability, 'planning');
  assert.deepEqual(request.context.topic_candidates.map(row => row.topicId), [2]);
  assert.match(request.input.objective, /English/);
  assert.deepEqual(f.calls.filter(call => call.table).map(call => call.table), ['activities', 'activity_topics']);
});

test('topic advice rejects anonymous and ended activities; empty pools never invoke AI', async () => {
  const f = fixture();
  const anonymous = { auth: () => ({ getUserInfo: () => ({ uid: '', isAnonymous: true }) }) };
  assert.deepEqual(await run({ activity_id: 21, language: 'en' }, { ...f, app: anonymous }), { error: 'UNAUTHORIZED' });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await run({ activity_id: 21, language: 'bad' }, f), { error: 'INVALID_LANGUAGE' });
  f.context.activity.data.status = 'reviewed';
  assert.deepEqual(await run({ activity_id: 21, language: 'en' }, f), { error: 'ACTIVITY_NOT_PREPARING' });
  f.context.activity.data.status = 'preparing';
  f.rows.activity_topics = [];
  const empty = await run({ activity_id: 21, language: 'zh-CN' }, f);
  assert.deepEqual(empty.recommendations, []);
  assert.equal(f.calls.some(call => call.skill), false);
});
