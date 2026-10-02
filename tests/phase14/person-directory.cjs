'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === '@cloudbase/node-sdk') return { init: () => ({ auth: () => ({ getUserInfo: () => ({ uid: '' }) }) }) };
  return originalLoad.call(this, name, parent, main);
};
const { createService, main } = require('../../cloudfunctions/person_360/index.js');
Module._load = originalLoad;

test('people directory is paged, field-limited, and read-only', async () => {
  const calls = [];
  const service = createService({ request: async (table, method, filters) => {
    calls.push({ table, method, filters });
    return [{ id: 1, display_name: '甲' }, { id: 2, display_name: '乙' }, { id: 3, display_name: '丙' }];
  } });
  const result = await service.listPeople({ page: 2, pageSize: 2, keyword: '张玮' });
  assert.deepEqual(result.rows.map(person => person.id), [1, 2]);
  assert.equal(result.hasMore, true);
  assert.deepEqual(calls.map(call => [call.table, call.method]), [['persons', 'GET']]);
  assert.equal(calls[0].filters.offset, 2);
  assert.equal(calls[0].filters.limit, 3);
  assert.equal(calls[0].filters.display_name, 'ilike.*张玮*');
  assert.equal(calls[0].filters.select, 'id,display_name,occupation,organization,legacy_customer_id');
  await assert.rejects(service.listPeople({ keyword: '*' }), /Invalid directory keyword/);
  await assert.rejects(service.listPeople({ pageSize: 1000 }), /Invalid directory page/);
  assert.equal(calls.length, 1);
});

test('opportunity directory maps explicit Person links before legacy customer links', async () => {
  const calls = [];
  const service = createService({ request: async (table, method, filters) => {
    calls.push({ table, method, filters });
    if (table === 'opportunities') return [
      { id: 10, person_id: 1, customer_id: 101, opportunity_type: 'insurance' },
      { id: 11, person_id: null, customer_id: 202, opportunity_type: 'recruit' },
    ];
    if (filters.id) return [{ id: 1, display_name: '甲', legacy_customer_id: 101 }];
    return [{ id: 2, display_name: '乙', legacy_customer_id: 202 }];
  } });
  const result = await service.listOpportunityDirectory({ pageSize: 20 });
  assert.equal(result.rows[0].person.display_name, '甲');
  assert.equal(result.rows[1].person.display_name, '乙');
  assert.equal(result.hasMore, false);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.equal(calls[0].filters.select, 'id,person_id,customer_id,opportunity_type,status,next_action,updated_at');
  assert.equal(calls[0].filters.deleted_at, 'is.null');
});

test('unauthenticated directory request is rejected before database access', async () => {
  assert.deepEqual(await main({ action: 'listPeople' }), { error: 'UNAUTHORIZED' });
});
