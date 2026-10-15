'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PersonInsightsService } = require('../../cloudfunctions/person_360/person-insights-service');
const { ContextItemLifecycleService } = require('../../cloudfunctions/person_360/context-item-lifecycle-service');

test('Person facts include source text, lineage, conflict and lifecycle audit state', async () => {
  const rows = [
    { id: 11, person_id: 71, interaction_id: 301, item_type: 'fact', category: 'need', content: 'Current A',
      source_type: 'ai_quick_capture_v2', source_id: 301, confirmed: true, created_at: '2026-10-10T00:00:00Z' },
    { id: 12, person_id: 71, interaction_id: 301, item_type: 'fact', category: 'need', content: 'Current B',
      source_type: 'ai_quick_capture_v2', source_id: 301, confirmed: true, created_at: '2026-10-11T00:00:00Z' },
    { id: 13, person_id: 71, interaction_id: 301, item_type: 'fact', category: 'need', content: 'Corrected',
      source_type: 'context_items', source_id: 11, confirmed: true, created_at: '2026-10-12T00:00:00Z' },
  ];
  const request = async (table, method, filters = {}) => {
    assert.equal(method, 'GET');
    if (table === 'persons') return [{ id: 71 }];
    if (table === 'context_items') {
      if (filters.item_type) return rows.filter(row => row.item_type === String(filters.item_type).slice(3));
      if (filters.id?.startsWith('in.')) return rows.filter(row => filters.id.slice(4, -1).split(',').includes(String(row.id)));
    }
    if (table === 'interactions') return [{ id: 301, person_id: 71, interaction_type: 'meeting',
      interaction_at: '2026-10-10T10:00:00Z', summary: 'Original conversation', raw_note: 'Original note text' }];
    if (table === 'crm_context_item_commands') return [{ item_id: 11, operation: 'correct', status: 'executed',
      executed_at: '2026-10-12T00:00:00Z', result: { newItemId: 13 } }];
    return [];
  };
  const service = new PersonInsightsService({ request, disclose: async () => ({ status: 'not_test_data' }) });
  const result = await service.context(71);
  assert.equal(result.groups.fact.find(row => row.id === 11).needsReview, true);
  assert.equal(result.groups.fact.find(row => row.id === 12).needsReview, true);
  assert.equal(result.groups.fact.find(row => row.id === 13).sourceInteraction.summary, 'Original conversation');
  assert.equal(result.groups.fact.find(row => row.id === 13).derivedFrom.id, 11);
  assert.equal(result.groups.fact.find(row => row.id === 11).supersededBy, 13);
});

test('lifecycle service binds actor and validates preview/execution payloads', async () => {
  const calls = [];
  const service = new ContextItemLifecycleService({ rpc: async (name, payload) => {
    calls.push({ name, payload }); return { previewId: 'd2be653a-6ee4-4e42-bceb-111111111111' };
  } });
  await service.preview({ idempotencyKey: 'da9f8f83-62bb-4d73-86fb-870432d2d711',
    personId: '71', itemId: '11', operation: 'correct', payload: { category: 'need', content: 'Updated' } }, 'uid-test');
  assert.equal(calls[0].name, 'crm_context_item_preview_v1');
  assert.equal(calls[0].payload.p_actor_uid, 'uid-test');
  assert.equal(calls[0].payload.p_payload.content, 'Updated');
  await service.execute('d2be653a-6ee4-4e42-bceb-111111111111', 'uid-test');
  assert.equal(calls[1].name, 'crm_context_item_execute_v1');
  await assert.rejects(service.preview({ personId: '71', itemId: '11', operation: 'confirm' }, 'uid-test'), /Invalid/);
  await assert.rejects(service.execute('not-a-preview', 'uid-test'), /Invalid/);
  assert.equal(calls.length, 2);
});
