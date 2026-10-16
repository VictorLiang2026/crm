'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getConversationPlaybookHistory } = require('../../cloudfunctions/assistant/conversation-playbook-history-service');

test('historical playbook citations resolve only against the task snapshot evidence', async () => {
  const calls = [];
  const result = await getConversationPlaybookHistory({ personId: '783' }, { read: async (table, filters) => {
    calls.push({ table, filters });
    if (table === 'ai_tasks') return [{ id: 5, input_snapshot: { objection: 'Concern' }, created_at: '2026-10-16',
      context_snapshot: { reliable_evidence: [
        { id: 11, source: 'Reviewed source', reference: { schema: 'public', table: 'knowledge_items', id: 11 } },
        { id: 12, source: 'Other source', reference: { schema: 'public', table: 'knowledge_items', id: 12 } },
      ] } }];
    return [{ result_json: { possibleUnderlyingReasons: ['Needs confirmation'], evidenceRefs: [11, 999], responseLogic: 'Check the source.' } }];
  } });
  assert.equal(result.hasResult, true);
  assert.deepEqual(result.evidenceRefs, [11]);
  assert.deepEqual(result.evidenceSources, [{ schema: 'public', table: 'knowledge_items', id: 11,
    label: 'Reviewed source', source_date: null, confidence: undefined }]);
  assert.equal(calls[0].filters.subject_id, 'eq.783');
});
