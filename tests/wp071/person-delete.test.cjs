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

const key = '5d998643-4c9a-44a5-a9b3-7605904b7ed2';
const previewId = 'a45da2ae-b2ed-42c0-992e-e68e53085acc';

test('person trash read RPC is explicitly allowlisted and keeps the public pagination contract', async () => {
  const previousEnv = process.env.TCB_ENV;
  const previousKey = process.env.CRM_PERSON360_DB_API_KEY;
  const previousFetch = global.fetch;
  const requests = [];
  process.env.TCB_ENV = 'crm-d1gkae8ddc930d151';
  process.env.CRM_PERSON360_DB_API_KEY = 'test-key';
  global.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return { ok: true, json: async () => ({ rows: [], page: 1, pageSize: 20, total: 0, totalPages: 1, hasMore: false }) };
  };
  try {
    const result = await createService().listPersonTrash({ page: 1, pageSize: 20 });
    assert.match(requests[0].url, /\/rpc\/person_trash_page_v1$/);
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      p_page: 1, p_page_size: 20, p_roles: [],
      p_customer_priorities: [], p_recruit_priorities: [], p_referral_priorities: [],
    });
    assert.equal(requests[0].init.headers['Content-Profile'], 'public');
    assert.deepEqual(result.rows, []);
  } finally {
    global.fetch = previousFetch;
    if (previousEnv === undefined) delete process.env.TCB_ENV; else process.env.TCB_ENV = previousEnv;
    if (previousKey === undefined) delete process.env.CRM_PERSON360_DB_API_KEY; else process.env.CRM_PERSON360_DB_API_KEY = previousKey;
  }
});

function fixture(rpcResult = { ok: true }) {
  const calls = [];
  const service = createService({
    request: async () => { throw Error('Unexpected read'); },
    rpc: async (operation, body) => { calls.push({ operation, body }); return rpcResult; },
  });
  return { service, calls };
}

test('person delete preview requires a UUID idempotency key and a valid Person ID', async () => {
  const f = fixture({ previewId, preview: {}, status: 'preview' });
  await assert.rejects(f.service.previewPersonDelete({ idempotencyKey: 'x', personId: '20' }, 'u'), /Invalid idempotency key/);
  await assert.rejects(f.service.previewPersonDelete({ idempotencyKey: key, personId: '0' }, 'u'), /Invalid Person ID/);
  await assert.rejects(f.service.previewPersonDelete(null, 'u'), /Invalid person delete command/);
  assert.equal(f.calls.length, 0);
  await f.service.previewPersonDelete({ idempotencyKey: key, personId: '20' }, 'test-uid');
  assert.deepEqual(f.calls[0], { operation: 'crm_person_delete_preview_v1',
    body: { p_actor_uid: 'test-uid', p_idempotency_key: key, p_person_id: 20 } });
});

test('person delete execute accepts only a UUID preview bound to the actor', async () => {
  const f = fixture({ ok: true, result: { personId: 20 } });
  await assert.rejects(f.service.executePersonDelete({ previewId: '20' }, 'test-uid'), /Invalid preview ID/);
  assert.equal(f.calls.length, 0);
  await f.service.executePersonDelete({ previewId }, 'test-uid');
  assert.deepEqual(f.calls[0], { operation: 'crm_person_delete_execute_v1',
    body: { p_actor_uid: 'test-uid', p_preview_id: previewId } });
});

test('person restore rejects forged input and calls the scoped RPC', async () => {
  const f = fixture({ ok: true, personId: 20, batchScoped: true });
  await assert.rejects(f.service.restorePerson({ personId: '20' }, ''), /Unauthorized/);
  await assert.rejects(f.service.restorePerson({ personId: 'abc' }, 'test-uid'), /Invalid Person ID/);
  assert.equal(f.calls.length, 0);
  await f.service.restorePerson({ personId: '20' }, 'test-uid');
  assert.deepEqual(f.calls[0], { operation: 'crm_person_restore_v1',
    body: { p_actor_uid: 'test-uid', p_person_id: 20 } });
  await f.service.restorePerson('20', 'test-uid');
  assert.equal(f.calls.length, 2);
});

test('person trash returns the existing public filtered RPC page unchanged', async () => {
  const response = { rows: [
    { id: 20, display_name: '甲', customer_id: 910001, customer_deleted: true, batch_scoped: true },
    { id: 21, display_name: '乙', customer_id: null, customer_deleted: null, batch_scoped: false },
  ], total: 2, page: 1, pageSize: 20, totalPages: 1, hasMore: false };
  const calls = [];
  const res = await createService({ rpc: async (name, params) => {
    calls.push({ name, params });
    return response;
  } }).listPersonTrash({ page: 1, pageSize: 20 });
  assert.deepEqual(calls, [{ name: 'person_trash_page_v1', params: {
    p_page: 1, p_page_size: 20, p_roles: [], p_customer_priorities: [],
    p_recruit_priorities: [], p_referral_priorities: [],
  } }]);
  assert.deepEqual(res, response);
});

test('person trash rejects an out-of-range page', async () => {
  const service = createService({ request: async () => [], rpc: async () => {} });
  await assert.rejects(service.listPersonTrash({ page: 0 }), /Invalid directory page/);
  await assert.rejects(service.listPersonTrash({ pageSize: 51 }), /Invalid directory page/);
});

// ---------- migration / rollback 静态契约 ----------
const ROOT = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(ROOT, 'cloudbase', 'migrations', '20261011120000_person_recycle_bin.sql'), 'utf8');
const rollback = fs.readFileSync(
  path.join(ROOT, 'cloudbase', 'migrations', '20261011120000_person_recycle_bin.rollback.sql'), 'utf8');

test('migration is additive and service_role-scoped', () => {
  for (const table of ['persons', 'opportunities', 'relationships', 'households',
    'household_members', 'activity_participants', 'activity_speakers']) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS delete_batch_id uuid`));
  }
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.person_delete_commands/);
  assert.match(migration, /UNIQUE\(actor_uid,idempotency_key\)/);
  for (const fn of ['crm_person_delete_preview_v1', 'crm_person_delete_execute_v1', 'crm_person_restore_v1']) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`));
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC,anon,authenticated`));
  }
  // 既有客户树复用旧级联函数，不重写。
  assert.match(migration, /public\.crm_delete_batch\('customer','remove'/);
  assert.match(migration, /public\.crm_delete_batch\('customer','restore'/);
  // 测试账号护栏贯穿三个函数。
  assert.equal((migration.match(/Test account requires tracked fictional Person/g) || []).length, 3);
});

test('rollback drops exactly what the migration adds', () => {
  for (const fn of ['crm_person_delete_preview_v1', 'crm_person_delete_execute_v1', 'crm_person_restore_v1']) {
    assert.match(rollback, new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}`));
  }
  assert.match(rollback, /DROP TABLE IF EXISTS public\.person_delete_commands/);
  for (const table of ['persons', 'opportunities', 'relationships', 'households',
    'household_members', 'activity_participants', 'activity_speakers']) {
    assert.match(rollback, new RegExp(`ALTER TABLE public\\.${table}\\s+DROP COLUMN IF EXISTS delete_batch_id`));
  }
  assert.doesNotMatch(rollback, /crm_delete_batch/);
});
