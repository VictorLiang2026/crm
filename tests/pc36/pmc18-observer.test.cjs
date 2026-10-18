'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/pmc18_observer/index.js'), 'utf8');
const snapshot = () => ({
  version: 'pmc18-metrics-v1', environment: 'crm-d1gkae8ddc930d151',
  mappings: { customers_without_person: 0, recruits_without_person: 0 },
  field_drift: { drift_rows: 0 }, duplicate_persons: { dup_groups: 0 },
  orphans: { gift_customer_id: 0, interaction_person_id: 1 },
  softdelete_cross: { person_alive_customer_deleted: 0, person_deleted_customer_alive: 0 },
  roles: { duplicate_role_rows: 0 }, no_role: { no_role: 3 },
  counts: { persons: { total: 10, softDeleted: 1 }, customers: { total: 8, softDeleted: 0 } },
});

function load(mock) {
  const module = { exports: {} };
  const calls = { rpc: [], from: [], inserted: null };
  const rdb = {
    rpc: async name => { calls.rpc.push(name); return mock.rpc ? mock.rpc(name) : { data: snapshot(), error: null }; },
    from: name => {
      calls.from.push(name);
      if (name === 'pmc18_observations') return {
        insert: rows => { calls.inserted = rows; return mock.insert ? mock.insert(rows) : Promise.resolve({ data: null, error: null }); },
        select: () => ({ order: () => ({ limit: async () => mock.list || { data: [{ id: 1 }], error: null } }) }),
      };
      throw Error('Unexpected relation: ' + name);
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
    process: { env: { TCB_ENV: 'crm-d1gkae8ddc930d151' } },
  }, { filename: 'pmc18_observer/index.js' });
  return { main: module.exports.main, calls };
}

test('PMC18 collect calls public metrics RPC, checks shape, and inserts monitoring rows', async () => {
  const { main, calls } = load({});
  const result = await main({ action: 'collect' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.rpc, ['pmc18_collect_metrics']);
  assert.deepEqual(calls.from, ['pmc18_observations']);
  assert.equal(result.metrics, calls.inserted.length);
  assert.ok(calls.inserted.some(row => row.metric === 'orphan_interaction_person_id' && row.value === '1'));
  assert.ok(calls.inserted.some(row => row.metric === 'count_customers' && row.value === '8'));
});

test('PMC18 collect accepts the SDK single-row JSON wrapper', async () => {
  const { main } = load({ rpc: async () => ({ data: [{ pmc18_collect_metrics: JSON.stringify(snapshot()) }], error: null }) });
  assert.equal((await main({})).ok, true);
});

test('PMC18 RPC failure or malformed snapshot never inserts rows', async () => {
  for (const rpc of [
    async () => ({ error: { message: 'rpc denied' } }),
    async () => ({ data: { version: 'wrong' }, error: null }),
    async () => ({ data: { ...snapshot(), counts: {} }, error: null }),
    async () => ({ data: '{invalid', error: null }),
  ]) {
    const { main, calls } = load({ rpc });
    const result = await main({ action: 'collect' });
    assert.equal(typeof result.error, 'string');
    assert.equal(calls.inserted, null);
  }
});

test('PMC18 waits for insert and reports insert failure', async () => {
  let finish;
  const { main, calls } = load({ insert: () => new Promise(resolve => { finish = resolve; }) });
  const pending = main({ action: 'collect' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.inserted.length > 0);
  finish({ error: { message: 'insert denied' } });
  assert.match((await pending).error, /insert denied/);
});

test('PMC18 listRecent retains the old result and never invokes the metrics RPC', async () => {
  const { main, calls } = load({ list: { data: [{ id: 1 }, { id: 2 }], error: null } });
  const result = await main({ action: 'listRecent', limit: 2 });
  assert.equal(result.total, 2);
  assert.deepEqual(calls.rpc, []);
  assert.equal(calls.inserted, null);
});
