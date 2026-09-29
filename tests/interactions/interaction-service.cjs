'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { InteractionService } = require('../../cloudfunctions/_shared/interaction-service');

test('deployed InteractionService and Legacy Adapter copies match shared sources', () => {
  const root = path.resolve(__dirname, '../..');
  for (const file of ['interaction-service.js', 'legacy-interaction-adapter.js']) {
    assert.deepEqual(
      fs.readFileSync(path.join(root, 'cloudfunctions/person_360', file)),
      fs.readFileSync(path.join(root, 'cloudfunctions/_shared', file)),
    );
  }
});

function fixture({ materialized = false, standalone = false } = {}) {
  const calls = [];
  const tables = {
    persons: [{ id: 11, legacy_customer_id: standalone ? null : 101 }],
    interactions: [{ id: 1, person_id: 11, interaction_type: 'meeting',
      interaction_at: '2026-09-15T10:00:00Z', summary: '人工记录', source_type: 'manual', source_id: null },
      ...(materialized ? [{ id: 2, person_id: 11, interaction_type: 'followup',
        interaction_at: '2026-09-10T00:00:00Z', summary: '已导入', source_type: 'followups', source_id: 5 }] : [])],
    followups: [{ Id: 5, customer_id: 101, followup_date: '2026-09-10', interaction_summary: '电话沟通', followup_notes: '客户反馈' }],
    recruit_candidates: [{ id: 7, customer_id: 101, person_id: 11 },
      { id: 9, customer_id: 202, person_id: 22 }],
    recruit_followups: [{ id: 8, candidate_id: 7, followup_date: '2026-09-12',
      interaction_summary: '增员沟通', followup_notes: '下次再谈', contact_method: 'phone' },
      { id: 10, candidate_id: 9, followup_date: '2026-09-13', interaction_summary: '其他人的跟进' }],
    activity_speakers: [{ id: 30, customer_id: 101, recruit_candidate_id: null },
      { id: 31, customer_id: 202, recruit_candidate_id: 7 }],
    activity_participants: [
      { id: 20, activity_id: 40, person_type: 'customer', person_id: 101, status: 'attended', created_at: '2026-09-11T03:00:00Z' },
      { id: 21, activity_id: 41, person_type: 'speaker', person_id: 30, status: 'attended', created_at: '2026-09-13T03:00:00Z' },
      { id: 22, activity_id: 42, person_type: 'customer', person_id: 101, status: 'invited', created_at: '2026-09-14T03:00:00Z' },
      { id: 23, activity_id: 42, person_type: 'speaker', person_id: 31, status: 'attended', created_at: '2026-09-14T03:00:00Z' },
    ],
    activities: [{ id: 40, name: '客户沙龙', activity_date: '2026-09-11' },
      { id: 41, name: '演讲活动', activity_date: '2026-09-13' },
      { id: 42, name: '仅邀请', activity_date: '2026-09-14' }],
  };
  async function request(table, method, filters = {}, body) {
    calls.push({ table, method, filters, body });
    if (method === 'POST' && table === 'interactions') return [{ id: 3, ...body }];
    if (method !== 'GET' || !tables[table]) throw new Error('Unexpected database operation');
    let rows = tables[table];
    for (const [key, value] of Object.entries(filters)) {
      if (value.startsWith?.('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value.startsWith?.('in.')) rows = rows.filter(row => value.slice(4, -1).split(',').includes(String(row[key])));
    }
    return rows;
  }
  return { service: new InteractionService({ request }), calls, tables };
}

test('timeline reads all four sources without writes or invitations', async () => {
  const { service, calls } = fixture();
  const result = await service.listForPerson(11);
  assert.deepEqual(result.rows.map(row => row.source_type),
    ['manual', 'activity_participants', 'recruit_followups', 'activity_participants', 'followups']);
  assert.equal(result.rows[1].summary, '参加活动：演讲活动');
  assert.equal(result.rows[2].channel, 'phone');
  assert.deepEqual(result.rows.filter(row => row.virtual).map(row => [
    row.id, row.interaction_type, row.source_id, row.interaction_at,
  ]), [
    ['activity_participants:21', 'activity_participation', 21, '2026-09-12T16:00:00.000Z'],
    ['recruit_followups:8', 'recruit_followup', 8, '2026-09-11T16:00:00.000Z'],
    ['activity_participants:20', 'activity_participation', 20, '2026-09-10T16:00:00.000Z'],
    ['followups:5', 'followup', 5, '2026-09-09T16:00:00.000Z'],
  ]);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(calls.filter(call => ['followups', 'recruit_followups', 'activity_participants'].includes(call.table))
    .every(call => call.filters.deleted_at === 'is.null'));
});

test('new recruit followup is mapped by canonical Person and shown only once', async () => {
  const { service, calls } = fixture();
  const result = await service.listForPerson(11);
  assert.deepEqual(result.rows.filter(row => row.source_type === 'recruit_followups')
    .map(row => [row.source_id, row.summary, row.virtual]), [[8, '增员沟通', true]]);
  const candidateRead = calls.find(call => call.table === 'recruit_candidates');
  assert.equal(candidateRead.filters.person_id, 'eq.11');
  assert.ok(!calls.some(call => call.method !== 'GET'));
});

test('recruit followup edits and removal immediately change the read-through timeline', async () => {
  const { service, tables } = fixture();
  tables.recruit_followups[0].interaction_summary = '重新约定面谈';
  let rows = (await service.listForPerson(11)).rows;
  assert.equal(rows.find(row => row.source_type === 'recruit_followups').summary, '重新约定面谈');
  tables.recruit_followups.splice(0, 1);
  rows = (await service.listForPerson(11)).rows;
  assert.equal(rows.some(row => row.source_type === 'recruit_followups'), false);
});

test('materialized source takes precedence over the same virtual row', async () => {
  const { service } = fixture({ materialized: true });
  const result = await service.listForPerson(11);
  const matches = result.rows.filter(row => row.source_type === 'followups' && String(row.source_id) === '5');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].summary, '已导入');
});

test('standalone Person reads only their direct interactions', async () => {
  const { service, calls } = fixture({ standalone: true });
  const result = await service.listForPerson(11);
  assert.deepEqual(result.rows.map(row => row.source_type), ['manual']);
  assert.ok(calls.every(call => ['persons', 'interactions', 'activity_participants', 'activity_speakers'].includes(call.table)));
  assert.ok(calls.filter(call => call.table === 'activity_participants')
    .every(call => call.filters.canonical_person_id === 'eq.11' && call.filters.status === 'eq.attended'));
});

test('canonical-only attendance is read once and invitation is excluded', async () => {
  const { LegacyInteractionAdapter } = require('../../cloudfunctions/_shared/legacy-interaction-adapter');
  const adapter = new LegacyInteractionAdapter({ request: async (table, method, filters) => {
    assert.equal(method, 'GET');
    if (table === 'activity_participants') {
      assert.equal(filters.canonical_person_id, 'eq.11');
      return [{ id: 20, activity_id: 40, status: 'attended', canonical_person_id: 11 },
        { id: 21, activity_id: 40, status: 'invited', canonical_person_id: 11 }]
        .filter(row => row.status === 'attended');
    }
    if (table === 'activity_speakers') return [];
    if (table === 'activities') return [{ id: 40, name: '专属 Person 活动', activity_date: '2026-09-15' }];
    throw new Error(`Unexpected ${table}`);
  } });
  const rows = await adapter.listCanonicalAttended(11);
  assert.deepEqual(rows.map(row => row.id), ['activity_participants:20']);
  assert.equal(rows[0].importance, 3);
});

test('Person-only speaker attendance uses explicit speaker profile Person ID', async () => {
  const { LegacyInteractionAdapter } = require('../../cloudfunctions/_shared/legacy-interaction-adapter');
  const adapter = new LegacyInteractionAdapter({ request: async (table, method, filters) => {
    assert.equal(method, 'GET');
    if (table === 'activity_speakers') return [{ id: 30, person_id: 11 }];
    if (table === 'activity_participants' && filters.canonical_person_id) return [];
    if (table === 'activity_participants' && filters.person_type === 'eq.speaker') {
      return [{ id: 31, activity_id: 40, person_type: 'speaker', person_id: 30, status: 'attended' }];
    }
    if (table === 'activities') return [{ id: 40, name: '嘉宾活动', activity_date: '2026-09-15' }];
    throw new Error(`Unexpected ${table}`);
  } });
  assert.deepEqual((await adapter.listCanonicalAttended(11)).map(row => row.id), ['activity_participants:31']);
});

test('manual capture validates identity, explicit time, Person and fields', async () => {
  const { service, calls } = fixture();
  const data = { interaction_type: 'meeting', interaction_at: '2026-09-15T18:00:00+08:00', summary: '人工面谈' };
  await assert.rejects(service.createManual(11, data, ''), /UNAUTHORIZED/);
  await assert.rejects(service.createManual(11, { ...data, interaction_at: '2026-09-15' }, 'uid'), /time/);
  await assert.rejects(service.createManual(11, { ...data, summary: '' }, 'uid'), /data/);
  await assert.rejects(service.createManual(999, data, 'uid'), /Person not found/);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('manual capture writes only interactions and records the actor', async () => {
  const { service, calls } = fixture();
  const result = await service.createManual(11, {
    interaction_type: 'meeting', interaction_at: '2026-09-15T18:00:00+08:00',
    channel: 'in_person', summary: '人工面谈', raw_note: '当面讨论', importance: 4,
  }, 'test-uid');
  assert.equal(result.interaction.source_type, 'manual');
  const writes = calls.filter(call => call.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, 'interactions');
  assert.equal(writes[0].body.created_by_uid, 'test-uid');
  assert.equal(writes[0].body.source_id, null);
});

test('timeline limit is bounded', async () => {
  const { service } = fixture();
  await assert.rejects(service.listForPerson(11, { limit: 51 }), /limit/);
  const result = await service.listForPerson(11, { limit: 2 });
  assert.equal(result.rows.length, 2);
  assert.equal(result.hasMore, true);
});
