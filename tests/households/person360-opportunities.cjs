'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === '@cloudbase/node-sdk') return { init: () => ({ auth: () => ({ getUserInfo: () => ({ uid: '' }) }) }) };
  return originalLoad.call(this, name, parent, isMain);
};
const { createService, main } = require('../../cloudfunctions/person_360');
Module._load = originalLoad;

function fixture() {
  const people = [{ id: 11, legacy_customer_id: 101 }, { id: 12, legacy_customer_id: null }];
  const rows = [
    { id: 21, person_id: 11, customer_id: 101, opportunity_type: '教育规划', updated_at: '2026-09-20' },
    { id: 22, person_id: null, customer_id: 101, opportunity_type: '转介绍', updated_at: '2026-09-21' },
    { id: 23, person_id: 12, customer_id: null, opportunity_type: 'recruit', updated_at: '2026-09-22' },
  ];
  const calls = [];
  async function request(table, method, filters = {}, body) {
    calls.push({ table, method, filters, body });
    if (table === 'persons') {
      assert.equal(method, 'GET');
      return people.filter(p => String(p.id) === filters.id?.slice(3));
    }
    assert.equal(table, 'opportunities');
    const selected = rows.filter(row => Object.entries(filters).every(([key, value]) => {
      if (!['id', 'person_id', 'customer_id', 'deleted_at'].includes(key)) return true;
      return value === 'is.null' ? row[key] == null : String(row[key]) === value.slice(3);
    }));
    if (method === 'GET') return selected;
    if (method === 'POST') { const saved = { id: 24, ...body }; rows.push(saved); return [saved]; }
    if (method === 'PATCH') { selected.forEach(row => Object.assign(row, body)); return selected; }
    throw new Error('Unexpected database operation');
  }
  return { service: createService({ request }), calls };
}

test('anonymous Person opportunity actions fail before database access', async () => {
  assert.deepEqual(await main({ action: 'listOpportunities', personId: 11 }), { error: 'UNAUTHORIZED' });
  assert.deepEqual(await main({ action: 'createOpportunity', personId: 11, data: {} }), { error: 'UNAUTHORIZED' });
});

test('Person list merges linked and legacy customer-only opportunities', async () => {
  const { service, calls } = fixture();
  const result = await service.listOpportunities(11);
  assert.deepEqual(result.rows.map(row => row.id), [22, 21]);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('Person create validates type and writes a customer-free row', async () => {
  const { service, calls } = fixture();
  const result = await service.createOpportunity(12, { opportunity_type: 'referral', next_action: '测试联系' });
  assert.equal(result.id, 24);
  const write = calls.find(call => call.method === 'POST');
  assert.equal(write.body.customer_id, null);
  assert.equal(write.body.person_id, 12);
  assert.equal(write.body.status, '潜在线索');
  await assert.rejects(service.createOpportunity(12, { opportunity_type: 'unknown' }), /type/);
  await assert.rejects(service.createOpportunity(12, { opportunity_type: 'referral', status: '方案' }), /status/);
});

test('Person writes cannot alter legacy or other Person opportunities', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.updateOpportunity(11, 21, { next_action: 'bad' }), /not found/);
  await assert.rejects(service.removeOpportunity(11, 23), /not found/);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
  assert.deepEqual(await service.closeOpportunity(12, 23), { ok: true });
  assert.deepEqual(await service.removeOpportunity(12, 23), { ok: true });
});

test('legacy customer API accepts English referral and preserves Chinese referral defaults', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/opportunities/index.js'), 'utf8');
  const writes = [];
  const updates = [];
  const exports = {};
  const rdb = { from(table) {
    const query = {
      select() { return query; }, eq() { return query; }, is() { return query; },
      maybeSingle() { return Promise.resolve({ data: table === 'customers' ? { Id: 101 } : { customer_id: 101 } }); },
      insert(data) {
        writes.push(data);
        return { select() { return Promise.resolve({ data: [{ id: 99 }] }); } };
      },
      update(data) {
        updates.push(data);
        return { eq() { return { select() { return Promise.resolve({ data: [{ id: 99 }] }); } }; } };
      },
    };
    return query;
  } };
  const context = vm.createContext({ exports, require(name) {
    assert.equal(name, './db');
    return { rdb, nowIso: () => '2026-09-29T00:00:00Z',
      normFields: (data, fields) => Object.fromEntries(Object.entries(data).filter(([key]) => fields.includes(key))),
      assertOk: result => result };
  } });
  new vm.Script(source).runInContext(context);
  for (const opportunity_type of ['referral', '转介绍']) {
    const result = await exports.main({ action: 'create', data: { customer_id: 101, opportunity_type } });
    assert.equal(result.id, 99);
  }
  assert.deepEqual(writes.map(row => row.status), ['潜在线索', '潜在线索']);
  assert.ok(writes.every(row => row.customer_id === 101 && row.person_id === undefined));
  await exports.main({ action: 'update', id: 99, data: { customer_id: 101 } });
  await exports.main({ action: 'update', id: 99, data: { customer_id: 102 } });
  assert.equal(updates[0].person_id, undefined);
  assert.equal(updates[1].person_id, null);
});
