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
    { id: 11, display_name: '张玮（电信）', name_key: '张玮' },
    { id: 22, display_name: '李宁', name_key: '李宁' },
  ];
  // PMC-20: legacy_customer_id 已退出（CL-03），客户链接经 customers.person_id 解析
  const customers = [
    { Id: 101, person_id: 11 },
    { Id: 202, person_id: 22 },
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
      return [];
    }
    if (table === 'customers') {
      if (method !== 'GET') throw new Error('Customer writes forbidden');
      if (filters.person_id?.startsWith('eq.'))
        return customers.filter(c => String(c.person_id) === filters.person_id.slice(3));
      if (filters.Id?.startsWith('eq.'))
        return customers.filter(c => String(c.Id) === filters.Id.slice(3));
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
  assert.equal(result.customerId, '101');
  assert.equal(result.household, null);
  assert.deepEqual(result.members, []);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('legacy one-step family writes are refused in favor of reviewed commands', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.addMember(11, 22, 'spouse', '李宁', true, 'test-uid'), /Preview required/);
  await assert.rejects(service.removeMember(11, 1, true), /Preview required/);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('legacy one-step family facts are refused in favor of reviewed commands', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.saveFacts(11, '有两个孩子'), /Preview required/);
  assert.ok(calls.every(call => call.table !== 'persons' || call.method === 'GET'));
});
