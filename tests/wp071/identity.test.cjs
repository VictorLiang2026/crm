'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
const name = '【系统测试·勿联系】虚构目录甲';

function fixture(people = []) {
  const calls = [];
  const request = async (table, method, filters) => {
    calls.push({ table, method, filters });
    if (table !== 'persons' || method !== 'GET') throw Error('Unexpected read');
    if (filters.deleted_at === 'not.is.null') return [];
    if (filters.name_key) return people;
    if (filters.id) return people.filter(p => String(p.id) === filters.id.slice(3));
    return [];
  };
  const rpc = async (operation, body) => {
    calls.push({ operation, body });
    return { previewId, preview: { kind: body.p_kind }, status: 'preview' };
  };
  return { service: createService({ request, rpc }), calls };
}

test('new Person requires resolution and defaults to no business role', async () => {
  const f = fixture();
  const result = await f.service.previewIdentity({ kind: 'person', idempotencyKey: key,
    displayName: name, occupation: '虚构职业' }, 'test-uid');
  assert.equal(result.previewId, previewId);
  const rpc = f.calls.find(c => c.operation);
  assert.equal(rpc.operation, 'person_identity_preview_v1');
  assert.equal(rpc.body.p_payload.display_name, name);
  assert.equal(rpc.body.p_payload.occupation, '虚构职业');
  assert.equal(rpc.body.p_payload.person_id, undefined);
  assert.equal(rpc.body.p_payload.customer, undefined);
  assert.equal(rpc.body.p_payload.speaker, undefined);
});

test('one matching Person is never automatically selected or duplicated', async () => {
  const f = fixture([{ id: 783, display_name: name, name_key: name.toLowerCase(),
    organization: null, occupation: null, legacy_customer_id: null }]);
  const resolved = await f.service.resolveIdentity(name);
  assert.equal(resolved.status, 'confirm_existing');
  assert.equal(resolved.selectedPersonId, null);
  await assert.rejects(f.service.previewIdentity({ kind: 'person', idempotencyKey: key,
    displayName: name }, 'test-uid'), /manual review/);
  assert.equal(f.calls.filter(c => c.operation).length, 0);
  const chosen = await f.service.previewIdentity({ kind: 'person', idempotencyKey: key,
    displayName: name, personId: 783 }, 'test-uid');
  assert.equal(chosen.previewId, previewId);
  assert.equal(f.calls.filter(c => c.operation).length, 1);
});

test('role conversion uses an explicit Person ID and recruit does not request customer', async () => {
  const person = { id: 783, display_name: name, name_key: name.toLowerCase(),
    organization: null, occupation: null, legacy_customer_id: null };
  const f = fixture([person]);
  await f.service.previewIdentity({ kind: 'recruit', idempotencyKey: key,
    personId: 783 }, 'test-uid');
  const rpc = f.calls.find(c => c.operation);
  assert.equal(rpc.body.p_kind, 'recruit');
  assert.equal(rpc.body.p_payload.person_id, '783');
  assert.equal(rpc.body.p_payload.customer, undefined);
  await assert.rejects(f.service.previewIdentity({ kind: 'customer',
    idempotencyKey: key, personId: 999 }, 'test-uid'), /not found/);
});

test('execute accepts only a receipt bound to the authenticated actor', async () => {
  const f = fixture();
  await assert.rejects(f.service.executeIdentity({ previewId: '783' }, 'test-uid'), /Invalid preview ID/);
  await f.service.executeIdentity({ previewId }, 'test-uid');
  assert.deepEqual(f.calls.find(c => c.operation).body,
    { p_actor_uid: 'test-uid', p_preview_id: previewId });
});
