'use strict';
const assert = require('node:assert/strict');
const { ParticipantService } = require('../../cloudfunctions/person_360/participant-service');

function fixture() {
  const tables = {
    persons: [
      { id: 11, display_name: '张玮（电信）', name_key: '张玮', deleted_at: null },
      { id: 22, display_name: '李宁', name_key: '李宁', deleted_at: null },
    ],
    customers: [{ Id: 101, person_id: 11, deleted_at: null }],
    recruit_candidates: [], activity_speakers: [],
    activities: [{ id: 301, deleted_at: null }],
    activity_participants: [],
  };
  const writes = [];
  async function request(table, method, filters = {}, body) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
    if (method === 'POST') {
      assert.equal(table, 'activity_participants');
      const row = { id: 401 + writes.length, deleted_at: null, ...body };
      tables[table].push(row); writes.push(row);
      return [row];
    }
    assert.equal(method, 'GET');
    return tables[table].filter(row => Object.entries(filters).every(([key, value]) => {
      if (['select', 'order', 'limit'].includes(key)) return true;
      if (value === 'is.null') return row[key] == null;
      if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
      if (value.startsWith('in.(')) return value.slice(4, -1).split(',').map(s => s.trim()).includes(String(row[key]));
      throw new Error(`Unexpected filter ${key}`);
    })).slice(0, Number(filters.limit || 100));
  }
  return { service: new ParticipantService({ request }), tables, writes };
}

const selected = {
  activityId: 301, personType: 'customer', canonicalPersonId: 11,
  selectedDisplayName: '张玮（电信）', confirmed: true,
};

module.exports = async function suite(_root, test) {
  const check = (name, fn) => test('activity-canonical.' + name, name, 'offline identity / write fixture', fn);
  await check('requires-human-selection', async () => {
    const f = fixture();
    await assert.rejects(f.service.add({ ...selected, confirmed: false }, 'test-user'), /Human confirmation/);
    await assert.rejects(f.service.add({ ...selected, selectedDisplayName: '李宁' }, 'test-user'), /Selected Person changed/);
    assert.equal(f.writes.length, 0);
  });
  await check('maps-active-customer-id', async () => {
    const f = fixture();
    const result = await f.service.add(selected, 'test-user');
    assert.equal(result.canonicalPersonId, '11');
    assert.equal(result.legacyLinked, true);
    assert.equal(f.writes[0].canonical_person_id, 11);
    assert.equal(f.writes[0].person_type, 'customer');
    assert.equal(f.writes[0].person_id, 101);
    await assert.rejects(f.service.add(selected, 'test-user'), /already added/);
    assert.equal(f.writes.length, 1);
  });
  await check('person-only-preserves-legacy-null', async () => {
    const f = fixture();
    const result = await f.service.add({ ...selected, personType: 'recruit', canonicalPersonId: 22,
      selectedDisplayName: '李宁' }, 'test-user');
    assert.equal(result.legacyLinked, false);
    assert.equal(f.writes[0].person_id, null);
    assert.equal(f.writes[0].canonical_person_id, 22);
  });
  await check('rejects-deleted-activity-and-duplicate-legacy-row', async () => {
    const f = fixture();
    f.tables.activities[0].deleted_at = '2026-09-29';
    await assert.rejects(f.service.add(selected, 'test-user'), /Activity not found/);
    f.tables.activities[0].deleted_at = null;
    f.tables.activity_participants.push({ id: 400, activity_id: 301, person_type: 'customer',
      person_id: 101, canonical_person_id: null, deleted_at: null });
    await assert.rejects(f.service.add(selected, 'test-user'), /already added/);
    assert.equal(f.writes.length, 0);
  });
};
