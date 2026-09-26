'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '@cloudbase/node-sdk') {
    return { init: () => ({ auth: () => ({ getUserInfo: () => ({ uid: '' }) }) }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { createService, main } = require('../../cloudfunctions/person_360/index.js');
Module._load = originalLoad;

function fixture() {
  const people = [
    { id: 11, display_name: '张玮（电信）', name_key: '张玮', legacy_customer_id: 101 },
    { id: 22, display_name: '李宁', name_key: '李宁', legacy_customer_id: 202 },
  ];
  let household = null;
  let members = [];
  const calls = [];
  async function request(table, method, filters = {}, body) {
    calls.push({ table, method, filters, body });
    if (table === 'persons') {
      if (method !== 'GET') throw new Error('Person writes forbidden');
      if (filters.id?.startsWith('eq.')) return people.filter(p => String(p.id) === filters.id.slice(3));
      if (filters.id?.startsWith('in.')) return people.filter(p => filters.id.includes(String(p.id)));
      if (filters.name_key) return people.filter(p => p.name_key === filters.name_key.slice(3));
      if (filters.legacy_customer_id) return people.filter(p => String(p.legacy_customer_id) === filters.legacy_customer_id.slice(3));
      return [];
    }
    if (table === 'households') {
      if (method === 'GET') return household && String(household.anchor_person_id) === filters.anchor_person_id?.slice(3) ? [household] : [];
      if (method === 'POST') { household = { id: 7, important_facts: null, ...body }; return [household]; }
      if (method === 'PATCH') { Object.assign(household, body); return [household]; }
    }
    if (table === 'household_members') {
      if (method === 'GET') return members.filter(m => !m.deleted_at);
      if (method === 'POST') { const item = { id: 9, ...body }; members.push(item); return [item]; }
      if (method === 'PATCH') { const item = members.find(m => String(m.id) === filters.id?.slice(3)); if (!item) return []; Object.assign(item, body); return [item]; }
    }
    throw new Error('Unexpected database operation');
  }
  return { service: createService({ request }), calls };
}

test('rejects anonymous function calls before any database access', async () => {
  assert.deepEqual(await main({ action: 'get', personId: 11 }), { error: 'UNAUTHORIZED' });
});

test('Person 360 reads an empty family without creating people or a household', async () => {
  const { service, calls } = fixture();
  const result = await service.get(11);
  assert.equal(result.person.display_name, '张玮（电信）');
  assert.equal(result.household, null);
  assert.deepEqual(result.members, []);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('manual confirmation and exact existing Person selection are mandatory', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.addMember(11, 22, 'spouse', '李宁', false, 'test-uid'), /Human confirmation/);
  await assert.rejects(service.addMember(11, 22, 'spouse', '错误的人', true, 'test-uid'), /Selected Person changed/);
  await assert.rejects(service.addMember(11, 999, 'spouse', '不存在', true, 'test-uid'), /already exist/);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('confirmed membership links only existing Persons and records the actor', async () => {
  const { service, calls } = fixture();
  const result = await service.addMember(11, 22, 'spouse', '李宁', true, 'test-uid');
  assert.equal(result.members[0].person.display_name, '李宁');
  assert.equal(result.members[0].relationship_to_anchor, 'spouse');
  const insert = calls.find(call => call.table === 'household_members' && call.method === 'POST');
  assert.equal(insert.body.confirmed_by_uid, 'test-uid');
  assert.ok(insert.body.confirmed_at);
  assert.ok(calls.every(call => call.table !== 'persons' || call.method === 'GET'));
});

test('facts stay bounded and do not create a Person', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.saveFacts(11, 'x'.repeat(2001)), /2000/);
  const result = await service.saveFacts(11, '有两个孩子');
  assert.equal(result.household.important_facts, '有两个孩子');
  assert.ok(calls.every(call => call.table !== 'persons' || call.method === 'GET'));
});
