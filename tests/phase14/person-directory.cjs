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

test('people directory delegates bounded sorting and pagination to public RPC', async () => {
  const calls = [];
  const service = createService({ rpc: async (name, params) => {
    calls.push({ name, params });
    return { rows: [{ id: 2, display_name: '【系统测试·勿联系】虚构乙' }],
      page: 2, pageSize: 2, total: 3, totalPages: 2 };
  } });
  const result = await service.listPeople({ page: 2, pageSize: 2, keyword: '虚构', sortField: 'id', sortDir: 'asc' });
  assert.equal(result.total, 3);
  assert.deepEqual(calls, [{ name: 'person_directory_page_v1', params: {
    p_page: 2, p_page_size: 2, p_keyword: '虚构', p_sort_field: 'id', p_sort_dir: 'asc',
  } }]);
  await service.listPeople({ keyword: '【系统测试·勿联系】虚构乙' });
  assert.equal(calls[1].params.p_keyword, '【系统测试·勿联系】虚构乙');
  for (const sortField of ['sales_priority','recruitment_priority','referral_priority','latest_followup_date','next_followup_date']) {
    await service.listPeople({ sortField, sortDir: 'asc' });
    assert.equal(calls.at(-1).params.p_sort_field, sortField);
    assert.equal(calls.at(-1).params.p_sort_dir, 'asc');
  }
  await service.listPersonTrash({ roles: ['recruit','customer','recruit'],
    recruitPriorities: ['A','C','A'], customerPriorities: ['B'], referralPriorities: [] });
  assert.deepEqual(calls.at(-1), { name:'person_trash_page_v1', params: {
    p_page:1, p_page_size:20, p_roles:['recruit','customer'],
    p_customer_priorities:['B'], p_recruit_priorities:['A','C'], p_referral_priorities:[],
  } });
  await assert.rejects(service.listPeople({ keyword: '*' }), /Invalid directory keyword/);
  await assert.rejects(service.listPeople({ pageSize: 1000 }), /Invalid directory page/);
  await assert.rejects(service.listPeople({ sortField: 'phone' }), /Invalid directory sort/);
  assert.equal(calls.length, 8);
});

test('opportunity directory maps explicit Person links before legacy customer links', async () => {
  const calls = [];
  const service = createService({ request: async (table, method, filters) => {
    calls.push({ table, method, filters });
    if (table === 'opportunities') return [
      { id: 10, person_id: 1, customer_id: 101, opportunity_type: 'insurance' },
      { id: 11, person_id: null, customer_id: 202, opportunity_type: 'recruit' },
    ];
    if (table === 'customers') return [
      { Id: 101, person_id: 1 }, { Id: 202, person_id: 2 },
    ];
    if (table === 'persons') return [
      { id: 1, display_name: '甲' }, { id: 2, display_name: '乙' },
    ];
    assert.fail(`Unexpected lookup table: ${table}`);
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
