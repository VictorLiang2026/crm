'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === '@cloudbase/node-sdk') return { init: () => ({ auth: () => ({ getUserInfo: () => ({ uid: '' }) }) }) };
  return originalLoad.call(this, name, parent, main);
};
const { createService } = require('../../cloudfunctions/person_360/index.js');
Module._load = originalLoad;

const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('customer directory view enriches only current customer rows with public Person stage', async () => {
  const reads = [];
  const service = createService({
    rpc: async () => ({ rows: [
      { id: '41', roles: ['customer'], display_name: '虚构客户甲' },
      { id: '42', roles: ['customer'], display_name: '虚构客户乙' },
    ], page: 1, pageSize: 20, total: 2, totalPages: 1, hasMore: false }),
    request: async (table, method, filters) => {
      reads.push({ table, method, filters });
      return [{ id: 41, customer_stage: '关系维护' }, { id: 42, customer_stage: null }];
    },
  });
  const result = await service.listPeople({ roles: ['customer'], includeCustomerStage: true });
  assert.equal(result.rows[0].customer_stage, '关系维护');
  assert.equal(result.rows[1].customer_stage, null);
  assert.deepEqual(reads, [{ table: 'persons', method: 'GET', filters: {
    select: 'id,customer_stage', id: 'in.(41,42)', deleted_at: 'is.null', limit: 50,
  } }]);
});

test('all People directory does not issue the customer-stage enrichment query', async () => {
  let reads = 0;
  const service = createService({
    rpc: async () => ({ rows: [{ id: '41', roles: ['customer'] }], page: 1, pageSize: 20, total: 1, totalPages: 1 }),
    request: async () => { reads++; return []; },
  });
  const result = await service.listPeople({});
  assert.equal(result.rows[0].customer_stage, undefined);
  assert.equal(reads, 0);
});

test('Person editor submits every populated section through the single transactional save', () => {
  const write = read('crm/js/modules/console/write.js');
  assert.match(write, /const hasCustomer = profile\.status === 'linked' && !!profile\.customerId/);
  assert.match(write, /customerExpectedUpdatedAt: f\.updated_at/);
  assert.match(write, /recruitExpectedUpdatedAt: f\.recruit_updated_at/);
  assert.match(write, /p360\(ctx, 'updatePerson', \{ data: \{/);
  assert.equal((write.match(/t\('btn_save_customer_profile'\)/g)||[]).length,0);
  assert.equal((write.match(/t\('btn_save_recruit_priority'\)/g)||[]).length,0);
  assert.match(write, /if \(f\.recruit_id\)/);
  assert.match(write, /customer_profile_json_invalid/);
});
test('customer edit labels are bilingual and legacy entry points stay untouched', () => {
  const i18n = read('crm/js/modules/console/i18n.js');
  for (const key of [
    'sec_customer_business', 'customer_profile_unavailable_note', 'customer_profile_conflict',
    'btn_save_customer_profile', 'btn_save_recruit_priority', 'people_customer_view',
    'people_all_view', 'customer_view_stage', 'field_mbti', 'person_profile_save_failed',
  ]) {
    assert.match(i18n, new RegExp(`'${key}': \\{ 'zh-CN': '[^']+', 'en': '[^']+' \\}`), `missing bilingual key ${key}`);
  }
  assert.match(read('crm/js/modules/console/pages/people.js'), /roles: \['customer'\]/);
  assert.match(read('crm/js/modules/console/pages/person.js'), /openPersonEdit\(ctx, \{ personId: String\(id\)/);
  assert.match(read('admin.html'), /location\.hash\s*=\s*'?#\/customer\//);
});
