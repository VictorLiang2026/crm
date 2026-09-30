'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RelationshipDecayService } = require('../../cloudfunctions/person_360/relationship-decay-service');

const now = () => new Date('2026-10-01T00:00:00Z');
const facts = [
  { id: 10, item_type: 'inference', category: 'relationship_strength', content: 'high',
    confirmed: true, created_at: '2026-09-01T00:00:00Z' },
  { id: 11, item_type: 'inference', category: 'relationship_importance', content: 'high',
    confirmed: true, created_at: '2026-09-01T00:00:00Z' },
];
const rows = ['2026-08-01','2026-08-08','2026-08-15','2026-08-22'].map((date, index) => ({
  id: index + 1, source_type: 'followups', source_id: index + 1, virtual: true,
  interaction_type: 'followup', interaction_at: `${date}T00:00:00Z`, importance: 3,
}));

test('service reads only bounded public facts and returns a candidate without writes', async () => {
  const calls = [];
  const service = new RelationshipDecayService({ now,
    request: async (table, method, filters) => {
      calls.push({ table, method, filters });
      if (table === 'persons') return [{ id: 7, legacy_customer_id: 9 }];
      if (table === 'context_items') return [...facts,
        { id: 12, item_type: 'fact', category: 'last_meaningful_interaction_at',
          content: '2026-09-01T00:00:00Z', confirmed: true,
          created_at: '2026-09-01T00:00:00Z' }];
      if (table === 'customers') return [{ Id: 9, sales_priority: 'A' }];
      throw new Error('Unexpected table');
    },
    listInteractions: async () => ({ rows }) });
  const result = await service.evaluateForPerson(7);
  assert.equal(result.status, 'signal');
  assert.equal(result.candidate, true);
  assert.equal(result.persisted, false);
  assert.equal(result.sources.last_meaningful, 'public.context_items#12');
  assert.deepEqual(calls.map(call => call.table).sort(), ['context_items','customers','persons']);
  assert.ok(calls.every(call => call.method === 'GET' && call.filters.limit <= 30));
});

test('legacy followups establish cadence but do not invent meaningful contact', async () => {
  const service = new RelationshipDecayService({ now,
    request: async table => table === 'persons' ? [{ id: 7, legacy_customer_id: null }] : facts,
    listInteractions: async () => ({ rows }) });
  const result = await service.evaluateForPerson(7);
  assert.equal(result.status, 'insufficient_evidence');
  assert.match(result.why, /最近一次重要互动/);
  assert.equal(result.sources.last_meaningful, null);
});

test('unconfirmed and expired facts cannot set relationship strength', async () => {
  const service = new RelationshipDecayService({ now,
    request: async table => table === 'persons' ? [{ id: 7, legacy_customer_id: null }] : [
      { ...facts[0], confirmed: false },
      { ...facts[0], id: 19, item_type: 'fact' },
      { ...facts[1], valid_to: '2026-09-01T00:00:00Z' },
    ], listInteractions: async () => ({ rows }) });
  const result = await service.evaluateForPerson(7);
  assert.equal(result.status, 'insufficient_evidence');
  assert.match(result.why, /关系强度/);
  assert.equal(result.sources.strength, null);
});

test('nonexistent or invalid Person fails before other reads', async () => {
  let calls = 0;
  const service = new RelationshipDecayService({ now, request: async () => { calls++; return []; } });
  await assert.rejects(service.evaluateForPerson(-1), /Invalid Person ID/);
  await assert.rejects(service.evaluateForPerson(7), /Person not found/);
  assert.equal(calls, 1);
});
