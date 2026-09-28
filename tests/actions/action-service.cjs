'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionService } = require('../../cloudfunctions/_shared/action-service');

function fixture() {
  const calls = [];
  const tables = {
    persons: [{ id: 11, legacy_customer_id: 101 }, { id: 12, legacy_customer_id: 102 }],
    opportunities: [{ id: 21, customer_id: 101 }, { id: 22, customer_id: 102 }],
    interactions: [{ id: 31, person_id: 11 }, { id: 32, person_id: 12 }],
    activities: [{ id: 41 }],
    actions: [{ id: 51, person_id: 11, title: '已有行动', status: 'open' }],
  };
  async function request(table, method, filters = {}, body) {
    calls.push({ table, method, filters, body });
    if (method === 'POST' && table === 'actions') return [{ id: 52, ...body }];
    if (method === 'PATCH' && table === 'actions') {
      return filters.person_id === 'eq.11' && filters.id === 'eq.51' &&
        filters.status === 'in.(open,in_progress)' ? [{ ...tables.actions[0], ...body }] : [];
    }
    if (method !== 'GET' || !tables[table]) throw new Error('Unexpected database request');
    let rows = tables[table];
    for (const [key, value] of Object.entries(filters)) {
      if (typeof value === 'string' && value.startsWith('eq.')) {
        rows = rows.filter(row => String(row[key]) === value.slice(3));
      }
      if (key === 'status' && value === 'in.(open,in_progress)') {
        rows = rows.filter(row => ['open', 'in_progress'].includes(row.status));
      }
    }
    return rows;
  }
  return { service: new ActionService({ request }), calls };
}

test('manual creation validates linked Person, opportunity, interaction and activity', async () => {
  const { service, calls } = fixture();
  const result = await service.createManual(11, {
    action_type: 'call', title: '联系测试客户', description: '讨论下次会面',
    due_at: '2026-10-01T10:00:00+08:00', priority: 'high',
    opportunity_id: 21, interaction_id: 31, activity_id: 41,
    urgency_score: 72.35, impact_score: 80,
  }, 'test-actor');
  assert.equal(result.action.source, 'manual');
  assert.equal(result.action.created_by_uid, 'test-actor');
  assert.equal(result.action.due_at, '2026-10-01T02:00:00.000Z');
  assert.deepEqual([result.action.opportunity_id, result.action.interaction_id, result.action.activity_id],
    [21, 31, 41]);
  assert.deepEqual(calls.filter(call => call.method !== 'GET').map(call => call.table), ['actions']);
});

test('wrong-person links, unsupported source and invalid scores fail before any write', async () => {
  const { service, calls } = fixture();
  const base = { action_type: 'call', title: '测试行动' };
  await assert.rejects(service.createManual(11, base, ''), /actor/);
  await assert.rejects(service.createManual(11, { ...base, source: 'ai_results' }, 'uid'), /source/);
  await assert.rejects(service.createManual(11, { ...base, urgency_score: 101 }, 'uid'), /score/);
  await assert.rejects(service.createManual(11, { ...base, due_at: '2026-10-01' }, 'uid'), /due_at/);
  await assert.rejects(service.createManual(11, { ...base, opportunity_id: 22 }, 'uid'), /Opportunity/);
  await assert.rejects(service.createManual(11, { ...base, interaction_id: 32 }, 'uid'), /Interaction/);
  await assert.rejects(service.createManual(11, { ...base, activity_id: 99 }, 'uid'), /Activity/);
  await assert.rejects(service.createManual(99, base, 'uid'), /Person/);
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
});

test('list is Person-scoped and bounded; closed actions require explicit opt-in', async () => {
  const { service, calls } = fixture();
  const result = await service.listForPerson(11);
  assert.equal(result.rows.length, 1);
  const first = calls.find(call => call.table === 'actions');
  assert.equal(first.filters.person_id, 'eq.11');
  assert.equal(first.filters.status, 'in.(open,in_progress)');
  await service.listForPerson(11, { includeClosed: true, limit: 5 });
  const last = calls.at(-1);
  assert.equal(last.filters.status, undefined);
  assert.equal(last.filters.limit, 5);
  await assert.rejects(service.listForPerson(11, { limit: 51 }), /limit/);
});

test('completion is scoped to one open action and records the actor', async () => {
  const { service, calls } = fixture();
  const result = await service.complete(11, 51, 'test-actor');
  assert.equal(result.action.status, 'completed');
  assert.equal(result.action.completed_by_uid, 'test-actor');
  assert.ok(Number.isFinite(Date.parse(result.action.completed_at)));
  const write = calls.find(call => call.method === 'PATCH');
  assert.deepEqual([write.filters.id, write.filters.person_id, write.filters.status],
    ['eq.51', 'eq.11', 'in.(open,in_progress)']);
  await assert.rejects(service.complete(11, 999, 'test-actor'), /Open action not found/);
  await assert.rejects(service.complete(11, 51, ''), /actor/);
});
