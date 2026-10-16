'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getPersonAIHistory } = require('../../cloudfunctions/assistant/person-ai-history-service');

test('Person AI history returns only supported task fields, public source references and linked legacy advice', async () => {
  const calls = [];
  const rows = {
    ai_tasks: [
      { id: 1, task_type: 'meeting_prep', status: 'completed', created_at: '2026-10-16T10:00:00Z',
        context_snapshot: { _context: { version: '2.0.0' }, reliable_evidence: [{ reference: { schema: 'public', table: 'knowledge_items', id: 11 }, source: 'Reviewed clause' }] } },
      { id: 2, task_type: 'unknown_task', status: 'completed', context_snapshot: {} },
    ],
    customers: [{ Id: 788 }],
    ai_results: [{ task_id: 1, result_json: { brief30Seconds: 'Review the verified clause', unexpected: 'private field' } }],
    ai_recommendations: [{ id: 9, recommendation_date: '2026-10-15', suggested_message: 'Ask permission to review', nba: { goal: 'Review' } }],
    persons: [{ id: 783 }],
  };
  const history = await getPersonAIHistory({ personId: '783' }, { read: async (table, filters) => {
    calls.push({ table, filters }); return rows[table] || [];
  } });
  assert.equal(history.generated.length, 1);
  assert.deepEqual(history.generated[0].result, { brief30Seconds: 'Review the verified clause' });
  assert.deepEqual(history.generated[0].sources, [{ schema: 'public', table: 'knowledge_items', id: '11', label: 'Reviewed clause' }]);
  assert.equal(history.legacy[0].suggestedMessage, 'Ask permission to review');
  assert.deepEqual(history.legacy[0].source, { schema: 'public', table: 'ai_recommendations', id: '9' });
  assert.deepEqual(calls.map(x => x.table), ['persons', 'ai_tasks', 'customers', 'ai_results', 'ai_recommendations']);
});

test('history rejects invalid person ids before reading and tolerates no linked customer', async () => {
  let calls = 0;
  await assert.rejects(getPersonAIHistory({ personId: '0' }, { read: async () => { calls++; return []; } }),
    error => error.code === 'INVALID_INPUT');
  assert.equal(calls, 0);
  const history = await getPersonAIHistory({ personId: '10' }, { read: async table => {
    calls++; return table === 'persons' ? [{ id: 10 }] : [];
  } });
  assert.deepEqual(history, { ok: true, generated: [], legacy: [] });
});

test('deleted or unknown Person does not expose previously stored AI results', async () => {
  const calls = [];
  await assert.rejects(getPersonAIHistory({ personId: '40' }, { read: async (table, filters) => {
    calls.push({ table, filters }); return [];
  } }), error => error.code === 'NOT_FOUND');
  assert.deepEqual(calls.map(call => call.table), ['persons']);
  assert.equal(calls[0].filters.deleted_at, 'is.null');
});
