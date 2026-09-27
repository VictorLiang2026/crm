'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LegacyInteractionAdapter } = require('../../cloudfunctions/_shared/legacy-interaction-adapter');

function fixture() {
  const calls = [];
  const tables = {
    followups: [
      { Id: 5, customer_id: 101, followup_date: '2026-09-10', interaction_summary: '电话沟通', followup_notes: '客户反馈', deleted_at: null },
      { Id: 6, customer_id: 101, followup_date: '2026-09-09', interaction_summary: '已删除', deleted_at: '2026-09-11' },
    ],
    recruit_candidates: [{ id: 7, customer_id: 101, deleted_at: null }],
    recruit_followups: [{ id: 8, candidate_id: 7, followup_date: '2026-09-12',
      interaction_summary: '增员沟通', followup_notes: '下次再谈', contact_method: 'phone', deleted_at: null }],
    activity_speakers: [{ id: 30, customer_id: 101, recruit_candidate_id: null, deleted_at: null }],
    activity_participants: [
      { id: 20, activity_id: 40, person_type: 'customer', person_id: 101, status: 'attended', deleted_at: null },
      { id: 21, activity_id: 41, person_type: 'speaker', person_id: 30, status: 'attended', deleted_at: null },
      { id: 22, activity_id: 42, person_type: 'customer', person_id: 101, status: 'invited', deleted_at: null },
    ],
    activities: [{ id: 40, name: '客户沙龙', activity_date: '2026-09-11', deleted_at: null },
      { id: 41, name: '演讲活动', activity_date: '2026-09-13', deleted_at: null }],
  };
  async function request(table, method, filters = {}) {
    calls.push({ table, method, filters });
    assert.equal(method, 'GET');
    assert.ok(Object.hasOwn(tables, table), `Unexpected source ${table}`);
    let rows = tables[table];
    for (const [key, value] of Object.entries(filters)) {
      if (value === 'is.null') rows = rows.filter(row => row[key] == null);
      if (typeof value === 'string' && value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (typeof value === 'string' && value.startsWith('in.')) rows = rows.filter(row => value.slice(4, -1).split(',').includes(String(row[key])));
    }
    return rows;
  }
  return { adapter: new LegacyInteractionAdapter({ request }), calls };
}

test('adapter projects all three active legacy sources without copying or writing', async () => {
  const { adapter, calls } = fixture();
  const rows = await adapter.listForCustomer(101);
  assert.deepEqual(rows.map(row => [row.source_type, row.source_id]), [
    ['followups', 5], ['recruit_followups', 8],
    ['activity_participants', 20], ['activity_participants', 21],
  ]);
  assert.deepEqual(rows.map(row => row.interaction_type),
    ['followup', 'recruit_followup', 'activity_participation', 'activity_participation']);
  assert.equal(rows[0].id, 'followups:5');
  assert.equal(rows[0].interaction_at, '2026-09-09T16:00:00.000Z');
  assert.equal(rows[0].summary, '电话沟通');
  assert.equal(rows[0].raw_note, '客户反馈');
  assert.equal(rows[1].channel, 'phone');
  assert.equal(rows[2].activity_id, 40);
  assert.equal(rows[3].summary, '参加活动：演讲活动');
  assert.ok(rows.every(row => row.virtual === true && row.importance === 3));
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(calls.filter(call => ['followups', 'recruit_followups', 'activity_participants'].includes(call.table))
    .every(call => call.filters.deleted_at === 'is.null'));
});

test('adapter rejects invalid identity before querying legacy data', async () => {
  const { adapter, calls } = fixture();
  await assert.rejects(adapter.listForCustomer('101,102'), /Invalid Person ID/);
  assert.equal(calls.length, 0);
});
