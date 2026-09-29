'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ActivityInteractionService } = require('../../cloudfunctions/person_360/activity-interaction-service');

function fixture({ type = 'customer', status = 'ended', legacyFollowup = false, canonical = true } = {}) {
  const calls = [];
  const participant = { id: 5, activity_id: 7, person_type: type,
    person_id: type === 'customer' ? 101 : type === 'speaker' ? 301 : 201,
    canonical_person_id: canonical ? 11 : null, participant_role: type === 'speaker' ? 'speaker' : 'attendee' };
  const tables = {
    activity_participants: [participant], activities: [{ id: 7, name: '测试活动', status }],
    persons: [{ id: 11, display_name: '[CRM_TEST_ONLY]人物', legacy_customer_id: 101 }],
    recruit_candidates: [{ id: 201, customer_id: 101 }],
    activity_speakers: [{ id: 301, person_id: 11, customer_id: 101 }],
    interactions: [], followups: legacyFollowup ? [{ Id: 9, customer_id: 101, activity_id: 7,
      interaction_summary: '已完成活动后联系并确认下次沟通时间' }] : [],
  };
  async function request(table, method, filters = {}, body) {
    calls.push({ table, method, filters, body });
    if (table === 'interactions' && method === 'POST') {
      const row = { id: 50 + tables.interactions.length, ...body };
      tables.interactions.push(row);
      return [row];
    }
    assert.equal(method, 'GET');
    assert.ok(Object.hasOwn(tables, table), `Unexpected ${table}`);
    let rows = tables[table];
    for (const [key, value] of Object.entries(filters)) {
      if (value === 'is.null') rows = rows.filter(row => row[key] == null);
      if (typeof value === 'string' && value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
    }
    return rows;
  }
  return { service: new ActivityInteractionService({ request }), calls, tables };
}

const base = { activityId: 7, participantId: 5, eventType: 'conversation',
  evidence: 'need', importance: 3, interactionAt: '2026-09-29T10:00:00+08:00',
  summary: '当面讨论保障需求并约定后续核对保单', confirmed: true };

test('registration and attendance do not create stored interactions', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.record({ ...base, eventType: 'attendance' }, 'uid'), /Attendance/);
  await assert.rejects(service.record({ ...base, confirmed: false }, 'uid'), /Human confirmation/);
  await assert.rejects(service.record({ ...base, importance: 2 }, 'uid'), /threshold/);
  await assert.rejects(service.record({ ...base, evidence: 'registered' }, 'uid'), /outcome/);
  assert.equal(calls.length, 0);
});

test('substantive conversation writes once and blocks exact retry', async () => {
  const { service, calls } = fixture();
  const result = await service.record(base, 'test-uid');
  assert.equal(result.personId, '11');
  const write = calls.find(call => call.method === 'POST');
  assert.equal(write.table, 'interactions');
  assert.equal(write.body.importance, 3);
  assert.equal(write.body.activity_id, 7);
  assert.equal(write.body.source_type, 'manual');
  assert.equal(write.body.created_by_uid, 'test-uid');
  await assert.rejects(service.record(base, 'test-uid'), /already recorded/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('legacy participant identity is resolved by ID, never by name', async () => {
  for (const type of ['customer', 'recruit', 'speaker']) {
    const { service } = fixture({ type, canonical: false });
    const data = type === 'speaker' ? { ...base, eventType: 'speaker_cooperation',
      evidence: 'topic', importance: 4 } : base;
    assert.equal((await service.record(data, 'uid')).personId, '11');
  }
});

test('speaker cooperation and post-event followup enforce their business gates', async () => {
  const ordinary = fixture();
  await assert.rejects(ordinary.service.record({ ...base, eventType: 'speaker_cooperation',
    evidence: 'topic', importance: 4 }, 'uid'), /speaker participant/);
  const speaker = fixture({ type: 'speaker' });
  await assert.rejects(speaker.service.record({ ...base, eventType: 'speaker_cooperation',
    evidence: 'topic', importance: 3 }, 'uid'), /threshold/);
  const upcoming = fixture({ status: 'confirmed' });
  await assert.rejects(upcoming.service.record({ ...base, eventType: 'post_event_followup',
    evidence: 'contacted' }, 'uid'), /ended activity/);
  assert.equal(upcoming.calls.filter(call => call.method === 'POST').length, 0);
});

test('existing legacy followup with the same activity and summary is not copied again', async () => {
  const { service, calls } = fixture({ legacyFollowup: true });
  await assert.rejects(service.record({ ...base, eventType: 'post_event_followup',
    evidence: 'contacted', summary: '已完成活动后联系并确认下次沟通时间' }, 'uid'), /already exists as a followup/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});
