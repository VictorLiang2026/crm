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

test('people directory delegates bounded sorting, pagination, and filters to public RPC', async () => {
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
  await service.listPeople({ roles: ['recruit','customer','recruit'], customerPriorities: ['A','A'], recruitPriorities: ['B'] });
  assert.deepEqual(calls.at(-1), { name: 'person_directory_filtered_page_v1', params: {
    p_page: 1, p_page_size: 20, p_keyword: '', p_sort_field: 'id', p_sort_dir: 'desc',
    p_roles: ['recruit','customer'], p_customer_priorities: ['A'], p_recruit_priorities: ['B'], p_referral_priorities: [],
  } });
  await service.listPersonTrash({ roles: ['recruit','customer','recruit'],
    recruitPriorities: ['A','C','A'], customerPriorities: ['B'], referralPriorities: [] });
  assert.deepEqual(calls.at(-1), { name:'person_trash_page_v1', params: {
    p_page:1, p_page_size:20, p_roles:['recruit','customer'],
    p_customer_priorities:['B'], p_recruit_priorities:['A','C'], p_referral_priorities:[],
  } });
  await assert.rejects(service.listPeople({ keyword: '*' }), /Invalid directory keyword/);
  await assert.rejects(service.listPeople({ pageSize: 1000 }), /Invalid directory page/);
  await assert.rejects(service.listPeople({ sortField: 'phone' }), /Invalid directory sort/);
  await assert.rejects(service.listPeople({ roles: ['invalid'] }), /Invalid directory filters/);
  await assert.rejects(service.listPeople({ roles: ['customer'], recruitPriorities: ['A'] }), /matching role/);
  assert.equal(calls.length, 9);
});

test('people directory falls back to the working scalar RPC when filtered RPC returns an untyped 404', async () => {
  const calls = [];
  const allRows = [
    { id: 1, roles: ['customer'], sales_priority: 'A', recruitment_priority: 'C' },
    { id: 2, roles: ['recruit'], sales_priority: 'C', recruitment_priority: 'B' },
    { id: 3, roles: ['participant'], sales_priority: 'A', recruitment_priority: null },
    { id: 4, roles: ['customer','recruit'], sales_priority: 'C', recruitment_priority: 'B' },
    { id: 5, roles: ['customer'], sales_priority: 'C', recruitment_priority: 'C' },
  ];
  const service = createService({ rpc: async (name, params) => {
    calls.push({ name, params });
    if (name === 'person_directory_filtered_page_v1') throw new Error('Database request failed (404)');
    const rows = params.p_page === 1 ? allRows.slice(0, 3) : allRows.slice(3);
    return { rows, page: params.p_page, pageSize: 50, total: 5, totalPages: 2 };
  } });
  const result = await service.listPeople({ page: 2, pageSize: 2, sortField: 'id', sortDir: 'asc',
    roles: ['customer','recruit'], customerPriorities: ['A'], recruitPriorities: ['B'] });
  assert.deepEqual(calls.map(call => call.name), [
    'person_directory_filtered_page_v1', 'person_directory_page_v1', 'person_directory_page_v1',
  ]);
  assert.equal(calls[1].params.p_page_size, 50);
  assert.equal(result.total, 3);
  assert.equal(result.totalPages, 2);
  assert.equal(result.page, 2);
  assert.deepEqual(result.rows.map(row => row.id), [4]);
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
