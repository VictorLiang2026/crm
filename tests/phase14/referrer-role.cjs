'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === '@cloudbase/node-sdk') return { init: () => ({ auth: () => ({ getUserInfo: () => ({ uid: '' }) }) }) };
  return originalLoad.call(this, name, parent, main);
};
const { createService } = require(path.resolve(__dirname, '../../cloudfunctions/person_360/index.js'));
Module._load = originalLoad;

function fixture({ active = true, referrer = false } = {}) {
  let role = referrer ? { id: 51, person_id: 7, role: 'referrer', origin: 'manual' } : null;
  const calls = [];
  const request = async (table, method, filters, body) => {
    calls.push({ table, method, filters, body });
    if (table === 'persons') return active ? [{ id: 7 }] : [];
    assert.equal(table, 'person_roles');
    if (method !== 'POST') assert.equal(filters?.role, 'eq.referrer');
    if (method === 'GET') return role ? [role] : [];
    if (method === 'POST') {
      assert.deepEqual(body, { person_id: 7, role: 'referrer', origin: 'manual' });
      role = { id: 51, ...body };
      return [role];
    }
    if (method === 'DELETE') {
      assert.equal(filters.id, 'eq.51');
      role = null;
      return [{ id: 51 }];
    }
    throw Error('Unexpected method');
  };
  return { service: createService({ request }), calls, getRole: () => role };
}

test('authenticated manual action adds and removes only the referrer role', async () => {
  const { service, calls, getRole } = fixture();
  const added = await service.setReferrerRole({ personId: '7', enabled: true, expectedEnabled: false }, 'user-1');
  assert.deepEqual(added, { personId: '7', role: 'referrer', enabled: true });
  assert.equal(getRole().origin, 'manual');
  assert.deepEqual(calls.filter(c => ['POST', 'DELETE'].includes(c.method)).map(c => [c.table, c.method]),
    [['person_roles', 'POST']]);
  const removed = await service.setReferrerRole({ personId: '7', enabled: false, expectedEnabled: true }, 'user-1');
  assert.equal(removed.enabled, false);
  assert.equal(getRole(), null);
  assert.deepEqual(calls.filter(c => ['POST', 'DELETE'].includes(c.method)).map(c => [c.table, c.method]),
    [['person_roles', 'POST'], ['person_roles', 'DELETE']]);
});

test('stale state, deleted Person, and invalid actor cannot write roles', async () => {
  const stale = fixture({ referrer: true });
  await assert.rejects(stale.service.setReferrerRole({ personId: 7, enabled: true, expectedEnabled: false }, 'user-1'), /role changed/);
  assert.equal(stale.calls.some(c => c.method !== 'GET'), false);
  const deleted = fixture({ active: false });
  await assert.rejects(deleted.service.setReferrerRole({ personId: 7, enabled: true, expectedEnabled: false }, 'user-1'), /Person not found/);
  assert.equal(deleted.calls.some(c => c.method !== 'GET'), false);
  const anonymous = fixture();
  await assert.rejects(anonymous.service.setReferrerRole({ personId: 7, enabled: true, expectedEnabled: false }, ''), /Invalid referrer/);
  assert.equal(anonymous.calls.length, 0);
});
