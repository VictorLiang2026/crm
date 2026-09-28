'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CommitmentService, beijingHorizon } = require('../../cloudfunctions/person_360/commitment-service');

test('Beijing horizon includes today and the next three calendar days', () => {
  assert.equal(beijingHorizon(new Date('2026-09-28T15:30:00Z')).toISOString(),
    '2026-10-01T16:00:00.000Z');
});

test('due reminders separate overdue and due soon, omit deleted people, and only read', async () => {
  const calls = [];
  const request = async (table, method, filters) => {
    calls.push({ table, method, filters });
    if (table === 'persons') return [{ id: 11, display_name: '[CRM_TEST_ONLY]人物甲' }];
    if (filters.due_at.startsWith('lt.')) return [
      { id: 1, person_id: 11, content: '逾期承诺', due_at: '2026-09-28T15:00:00Z' },
      { id: 2, person_id: 12, content: '已删除人物承诺', due_at: '2026-09-28T14:00:00Z' },
    ];
    return [
      { id: 3, person_id: 11, content: '三天内承诺', due_at: '2026-10-01T15:59:00Z' },
      { id: 4, person_id: 11, content: '第四天承诺', due_at: '2026-10-01T16:00:00Z' },
    ];
  };
  const result = await new CommitmentService({ request,
    now: () => new Date('2026-09-28T15:30:00Z') }).listDue();
  assert.deepEqual(result.overdue.map(row => row.id), [1]);
  assert.deepEqual(result.dueSoon.map(row => row.id), [3]);
  assert.equal(result.overdue[0].person_name, '[CRM_TEST_ONLY]人物甲');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(calls.filter(call => call.table === 'commitments')
    .every(call => call.filters.status === 'eq.open' && call.filters.limit === 51));
});
