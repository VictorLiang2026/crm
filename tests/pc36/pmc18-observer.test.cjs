'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/pmc18_observer/index.js'), 'utf8');
const receipt = (reused = false) => ({
  ok: true, reused, collectedAt: '2026-10-19T00:30:00+08:00', metrics: 20,
  ...(!reused && { summary: { customers_without_person: 0 } }),
});

function load(mock = {}) {
  const module = { exports: {} };
  const calls = { rpc: [], from: [] };
  const rdb = {
    rpc: async name => {
      calls.rpc.push(name);
      return mock.rpc ? mock.rpc(name) : { data: receipt(), error: null };
    },
    from: name => {
      calls.from.push(name);
      if (name !== 'pmc18_observations') throw Error('Unexpected relation: ' + name);
      return { select: () => ({ order: () => ({ limit: async () =>
        mock.list || { data: [{ id: 1 }], error: null } }) }) };
    },
  };
  const assertOk = result => {
    if (result?.error) throw Error(result.error.message || String(result.error));
    return result;
  };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => { assert.equal(name, './db'); return { rdb, assertOk }; },
    Date, JSON, Object, Number, Error,
  }, { filename: 'pmc18_observer/index.js' });
  return { main: module.exports.main, calls };
}

test('PMC18 collect delegates one atomic transaction to the fixed RPC', async () => {
  const { main, calls } = load();
  assert.equal((await main({ action: 'collect' })).metrics, 20);
  assert.deepEqual(calls.rpc, ['pmc18_collect_once_v1']);
  assert.deepEqual(calls.from, []);
});

test('PMC18 same-day replay returns the database receipt without a second write', async () => {
  const { main, calls } = load({ rpc: async () => ({ data: receipt(true), error: null }) });
  assert.equal((await main({})).reused, true);
  assert.deepEqual(calls.rpc, ['pmc18_collect_once_v1']);
  assert.deepEqual(calls.from, []);
});

test('PMC18 error and invalid receipt fail closed without direct table writes', async () => {
  for (const rpc of [
    async () => ({ error: { message: 'permission denied' } }),
    async () => ({ data: { ...receipt(), metrics: 19 }, error: null }),
    async () => ({ data: { ...receipt(), collectedAt: 'invalid' }, error: null }),
    async () => ({ data: { ...receipt(), summary: null }, error: null }),
    async () => ({ data: null, error: null }),
  ]) {
    const { main, calls } = load({ rpc });
    assert.equal(typeof (await main({ action: 'collect' })).error, 'string');
    assert.deepEqual(calls.from, []);
  }
});

test('PMC18 listRecent keeps the old read behavior', async () => {
  const { main, calls } = load({ list: { data: [{ id: 1 }, { id: 2 }], error: null } });
  assert.equal((await main({ action: 'listRecent', limit: 2 })).total, 2);
  assert.deepEqual(calls.rpc, []);
  assert.deepEqual(calls.from, ['pmc18_observations']);
});
