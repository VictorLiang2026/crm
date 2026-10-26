'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../cloudfunctions/ai_activity/activity-speaker-recommend-v2');

function fixture(status = 'preparing') {
  const calls = [];
  const context = { activity: { data: { id: 21, status }, source: { schema: 'public', table: 'activities', id: '21' } },
    participants: [{ data: { person_type: 'speaker', person_id: 1, canonical_person_id: 101 } }],
    speakers: [], tasks: [] };
  const engine = { buildContext: async input => { calls.push(input); return { context,
    context_snapshot: { ...context, _context: { recipe: 'activity_prepare', subjectId: 21 } } }; } };
  const rows = { activity_speakers: [
    { id: 1, person_id: 101, status: 'active', expertise: 'Finance' },
    { id: 2, person_id: 102, status: 'active', expertise: 'Health' },
    { id: 3, person_id: 103, status: 'active', expertise: 'Tax' },
  ], persons: [{ id: 101, display_name: 'Existing' },
    { id: 102, display_name: 'Person Master Name', organization: 'Clinic' }] };
  const rdb = { from(table) {
    calls.push({ table });
    let list = rows[table];
    const query = {
      select() { return this; },
      eq(field, value) { list = list.filter(row => row[field] === value); return this; },
      is() { return this; },
      order() { return this; },
      in(field, values) { list = list.filter(row => values.includes(row[field])); return this; },
      limit(count) { list = list.slice(0, count); return this; },
      then(resolve, reject) { return Promise.resolve({ data: list }).then(resolve, reject); },
    };
    return query;
  } };
  const gateway = { runAITask: async input => { calls.push(input); return { taskId: 91, resultId: 92,
    result: { recommendations: [
      { speakerId: 2, score: 88, reason: 'Relevant expertise', suggestedTopic: 'Health', contactSuggestion: 'Confirm availability' },
      { speakerId: 999, score: 99, reason: 'Forged', suggestedTopic: 'X', contactSuggestion: 'X' },
      { speakerId: 2, score: 80, reason: 'Duplicate', suggestedTopic: 'X', contactSuggestion: 'X' },
      { speakerId: 1, score: 70, reason: 'Already invited', suggestedTopic: 'X', contactSuggestion: 'X' },
    ], note: 'Review identity' } }; } };
  const app = { auth: () => ({ getUserInfo: () => ({ uid: 'operator', isAnonymous: false }) }) };
  return { calls, context, rows, engine, rdb, gateway, app };
}

test('speaker advice uses only current active Person-linked candidates and rejects model-invented or repeated IDs', async () => {
  const f = fixture();
  const result = await run({ activity_id: 21, language: 'en' }, f);
  assert.equal(result.business_data_written, false);
  assert.equal(result.requires_confirmation, true);
  assert.equal(result.result_id, 92);
  assert.deepEqual(result.recommendations.map(row => [row.speaker_id, row.person_id, row.speaker_name]),
    [[2, 102, 'Person Master Name']]);
  const request = f.calls.find(call => call.skill === 'activity_speaker_recommend');
  assert.equal(request.capability, 'planning');
  assert.deepEqual(request.context.speaker_candidates.map(row => row.speakerId), [2]);
  assert.match(request.input.objective, /English/);
  assert.deepEqual(f.calls.filter(call => call.table).map(call => call.table), ['activity_speakers', 'persons']);
});

test('speaker advice fails closed for anonymous, ended and participant-cap requests; empty pools never call AI', async () => {
  const f = fixture();
  const anonymous = { auth: () => ({ getUserInfo: () => ({ uid: '', isAnonymous: true }) }) };
  assert.deepEqual(await run({ activity_id: 21, language: 'en' }, { ...f, app: anonymous }), { error: 'UNAUTHORIZED' });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await run({ activity_id: 21, language: 'bad' }, f), { error: 'INVALID_LANGUAGE' });
  f.context.activity.data.status = 'ended';
  assert.deepEqual(await run({ activity_id: 21, language: 'en' }, f), { error: 'ACTIVITY_NOT_PREPARING' });
  f.context.activity.data.status = 'preparing';
  f.context.participants = Array(20).fill({ data: { person_type: 'speaker', person_id: 1 } });
  assert.deepEqual(await run({ activity_id: 21, language: 'en' }, f), { error: 'PARTICIPANTS_LIMIT' });
  f.context.participants = [{ data: { person_type: 'speaker', person_id: 1 } }];
  f.rows.persons = [];
  const empty = await run({ activity_id: 21, language: 'zh-CN' }, f);
  assert.deepEqual(empty.recommendations, []);
  assert.equal(f.calls.some(call => call.skill), false);
});
