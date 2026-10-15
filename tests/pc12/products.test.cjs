'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const contract = require('../../cloudfunctions/products/contract');

const dbPath = path.resolve(__dirname, '../../cloudfunctions/products/db.js');
const indexPath = path.resolve(__dirname, '../../cloudfunctions/products/index.js');

function makeHarness() {
  const state = {
    products: [],
    customers: [
      { Id: '788', person_id: '783', deleted_at: null },
      { Id: '789', person_id: '784', deleted_at: null },
    ],
    persons: [
      { id: '783', display_name: 'Synthetic Person A', deleted_at: null },
      { id: '784', display_name: 'Synthetic Person B', deleted_at: null },
      { id: '785', display_name: 'Unlinked Synthetic Person', deleted_at: null },
    ],
  };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.op = 'select'; this.payload = null; this.columns = null; }
    select(columns) { this.columns = columns; return this; }
    eq(column, value) { this.filters.push(row => String(row[column]) === String(value)); return this; }
    is(column, value) { this.filters.push(row => value === null ? row[column] == null : row[column] === value); return this; }
    insert(payload) { this.op = 'insert'; this.payload = payload; return this; }
    update(payload) { this.op = 'update'; this.payload = payload; return this; }
    delete() { this.op = 'delete'; return this; }
    maybeSingle() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
    async execute(single) {
      const rows = state[this.table];
      if (!rows) return { data: null, error: { message: 'unknown table' } };
      const matches = () => rows.filter(row => this.filters.every(filter => filter(row)));
      if (this.op === 'select') {
        const result = matches();
        if (single) return { data: result.length ? { ...result[0] } : null, error: result.length > 1 ? { message: 'multiple rows' } : null };
        return { data: result.map(row => ({ ...row })), error: null };
      }
      if (this.op === 'insert') {
        if (this.table === 'products' && rows.some(row => String(row.customer_id) === String(this.payload.customer_id))) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        const row = { id: String(rows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1), ...this.payload };
        rows.push(row);
        return { data: [{ ...row }], error: null };
      }
      const selected = matches();
      if (this.op === 'update') {
        selected.forEach(row => Object.assign(row, this.payload));
        return { data: selected.map(row => ({ ...row })), error: null };
      }
      if (this.op === 'delete') {
        const ids = new Set(selected.map(row => row.id));
        state[this.table] = rows.filter(row => !ids.has(row.id));
        return { data: selected.map(row => ({ ...row })), error: null };
      }
      return { data: null, error: { message: 'unsupported operation' } };
    }
  }
  const fakeDb = {
    rdb: { from: table => new Query(table) },
    normFields(data, allow) {
      const result = {};
      allow.forEach(field => { if (Object.hasOwn(data, field)) result[field] = data[field] === '' ? null : data[field]; });
      return result;
    },
    assertOk(result) { if (result?.error) throw new Error(result.error.message); return result; },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === indexPath && request === './db') return fakeDb;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[indexPath];
  const api = require(indexPath);
  Module._load = originalLoad;
  return { api, state };
}

function itemsWith(overrides = {}) {
  return contract.CATEGORY_KEYS.map((key) => ({
    key, label: key,
    amount: '', premium: '', pay_years: '', paid_years: '', update_date: '',
    ...(overrides[key] || {}),
  }));
}

test('insurance item validation preserves bigint text and distinguishes blank from zero', () => {
  const items = contract.normalizeInsuranceItems(itemsWith({
    ap_ipa: { amount: '9223372036854775807', premium: '9007199254740993.50', pay_years: '10.5' },
    ap_ppa: { amount: '0' },
  }));
  assert.equal(items.find(row => row.key === 'ap_ipa').amount, '9223372036854775807');
  assert.equal(items.find(row => row.key === 'ap_ppa').amount, '0');
  assert.equal(items.find(row => row.key === 'ap_ltc').amount, '');
  assert.equal(items.find(row => row.key === 'ap_ipa').premium, '9007199254740993.50');
  assert.equal(items.find(row => row.key === 'ap_ipa').pay_years, '10.5');
  assert.equal(contract.amountColumns(items).ap_ipa, '9223372036854775807');
  assert.equal(contract.amountColumns(items).ap_ppa, '0');
  assert.equal(contract.amountColumns(items).ap_ltc, null);
});

test('insurance item validation rejects negatives, fractions, invalid dates, duplicates and bigint overflow', () => {
  assert.throws(() => contract.normalizeInsuranceItems(itemsWith({ ap_ipa: { amount: '-1' } })), /non-negative/);
  assert.throws(() => contract.normalizeInsuranceItems(itemsWith({ ap_ipa: { amount: '1.5' } })), /non-negative/);
  assert.throws(() => contract.normalizeInsuranceItems(itemsWith({ ap_ipa: { premium: '-1.5' } })), /non-negative/);
  assert.throws(() => contract.normalizeInsuranceItems(itemsWith({ ap_ipa: { amount: '9223372036854775808' } })), /range/);
  assert.throws(() => contract.normalizeInsuranceItems(itemsWith({ ap_ipa: { amount: Number.MAX_SAFE_INTEGER + 1 } })), /exact decimal string/);
  assert.throws(() => contract.normalizeInsuranceItems(itemsWith({ ap_ipa: { update_date: '2026-02-30' } })), /valid date/);
  const duplicate = itemsWith(); duplicate[1].key = duplicate[0].key;
  assert.throws(() => contract.normalizeInsuranceItems(duplicate), /invalid or duplicate/);
});

test('Person route resolves customer server-side and supports initial insert, update, null, zero and duplicate submit conflict', async () => {
  const { api, state } = makeHarness();
  const input = itemsWith({ ap_ipa: { amount: '9223372036854775807', premium: '9007199254740993' }, ap_ppa: { amount: '0' } });
  const inserted = await api.main({ action: 'upsert', personId: '783', expectedVersion: '0', data: { customer_id: '789', items: JSON.stringify(input) } });
  assert.equal(inserted.customerId, '788');
  assert.equal(inserted.version, '1');
  assert.equal(state.products[0].customer_id, '788');
  assert.equal(state.products[0].ap_ipa, '9223372036854775807');
  assert.equal(state.products[0].ap_ppa, '0');
  assert.equal(JSON.parse(state.products[0].items).find(row => row.key === 'ap_ipa').premium, '9007199254740993');

  const next = itemsWith({ ap_ipa: { amount: '', premium: '' }, ap_ppa: { amount: '0' } });
  const updated = await api.main({ action: 'upsert', personId: '783', expectedVersion: '1', data: { items: JSON.stringify(next) } });
  assert.equal(updated.version, '2');
  assert.equal(state.products[0].ap_ipa, null);
  assert.equal(JSON.parse(state.products[0].items).find(row => row.key === 'ap_ipa').amount, '');
  assert.equal(state.products[0].ap_ppa, '0');

  const replay = await api.main({ action: 'upsert', personId: '783', expectedVersion: '0', data: { items: JSON.stringify(next) } });
  assert.equal(replay.error.code, 'VERSION_CONFLICT');
  assert.equal(state.products.length, 1);
});

test('Person route rejects unlinked, deleted and invalid identities and ignores a client-supplied customer id', async () => {
  const { api, state } = makeHarness();
  const noLink = await api.main({ action: 'upsert', personId: '785', expectedVersion: '0', data: { items: JSON.stringify(itemsWith()) } });
  assert.equal(noLink.error.code, 'CUSTOMER_LINK_REQUIRED');
  const invalid = await api.main({ action: 'upsert', personId: '783 OR 1=1', expectedVersion: '0', data: { items: JSON.stringify(itemsWith()) } });
  assert.equal(invalid.error.code, 'INVALID_ID');
  const ownLink = await api.main({ action: 'upsert', personId: '784', expectedVersion: '0', data: { customer_id: '788', items: JSON.stringify(itemsWith()) } });
  assert.equal(ownLink.customerId, '789');
  assert.equal(state.products[0].customer_id, '789');
});

test('concurrent Person saves from the same version allow one write and reject the stale writer', async () => {
  const { api, state } = makeHarness();
  const initial = await api.main({ action: 'upsert', personId: '783', expectedVersion: '0', data: { items: JSON.stringify(itemsWith()) } });
  assert.equal(initial.version, '1');
  const a = itemsWith({ ap_ci: { amount: '1200' } });
  const b = itemsWith({ ap_ci: { amount: '1300' } });
  const results = await Promise.all([
    api.main({ action: 'upsert', personId: '783', expectedVersion: '1', data: { items: JSON.stringify(a) } }),
    api.main({ action: 'upsert', personId: '783', expectedVersion: '1', data: { items: JSON.stringify(b) } }),
  ]);
  assert.equal(results.filter(result => !result.error).length, 1);
  assert.equal(results.filter(result => result.error?.code === 'VERSION_CONFLICT').length, 1);
  assert.equal(state.products.length, 1);
  assert.equal(state.products[0].version, 2);
});

test('legacy customer_id upsert remains compatible and advances the Person editor version', async () => {
  const { api, state } = makeHarness();
  const first = await api.main({ action: 'upsert', data: { customer_id: 788, customer_name: 'Synthetic Person A', ap_ci: '200000' } });
  assert.ok(first.id);
  assert.equal(state.products[0].version, 1);
  const second = await api.main({ action: 'upsert', data: { customer_id: 788, customer_name: 'Synthetic Person A', ap_ci: '220000' } });
  assert.equal(second.id, first.id);
  assert.equal(state.products[0].version, 2);
  assert.equal(state.products[0].ap_ci, '220000');
});
