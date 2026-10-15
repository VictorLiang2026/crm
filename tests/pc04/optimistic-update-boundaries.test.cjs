'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '../..');
const customerDb = path.join(root, 'cloudfunctions/customers/db.js');
const recruitDb = path.join(root, 'cloudfunctions/recruit_candidates/db.js');
const store = { tables: {} };
class Query {
  constructor(table) { this.table = table; this.filters = []; this.payload = null; }
  update(payload) { this.payload = payload; return this; }
  eq(field, value) { this.filters.push(row => String(row[field]) === String(value)); return this; }
  select() { return this; }
  async then(resolve, reject) { try { resolve(await this.execute()); } catch (error) { reject(error); } }
  async execute() {
    const rows = store.tables[this.table] || [];
    const selected = rows.filter(row => this.filters.every(match => match(row)));
    if (!this.payload) return { data: selected.map(row => ({ ...row })) };
    selected.forEach(row => Object.assign(row, this.payload));
    return { data: selected.map(row => ({ ...row })) };
  }
}
const dbStub = {
  rdb: { from: table => new Query(table) },
  assertOk: result => { if (result?.error) throw new Error(result.error.message || String(result.error)); return result; },
  normFields: (data, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(data, key))
    .map(key => [key, data[key] === '' ? null : data[key]])),
  nowIso: () => '2026-10-15T02:00:00Z',
};
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(name, parent); } catch (_) { resolved = null; }
  if (resolved && [customerDb, recruitDb].includes(path.resolve(resolved))) return dbStub;
  return originalLoad.call(this, name, parent, isMain);
};
const customers = require('../../cloudfunctions/customers/index.js');
const recruits = require('../../cloudfunctions/recruit_candidates/index.js');
Module._load = originalLoad;

test('customers.update accepts matching expectedUpdatedAt and rejects stale customer edits', async () => {
  store.tables.customers = [{ Id: 81, person_id: 71, deleted_at: null, updated_at: 'T1', tags: 'old' }];
  const saved = await customers.main({ action: 'update', id: '81', data: { tags: 'new' }, expectedUpdatedAt: 'T1', editSource: 'form' });
  assert.equal(saved.ok, true);
  assert.equal(store.tables.customers[0].tags, 'new');
  const stale = await customers.main({ action: 'update', id: '81', data: { tags: 'stale' }, expectedUpdatedAt: 'T1', editSource: 'form' });
  assert.equal(stale.code, 'CUSTOMER_CONFLICT');
  assert.equal(store.tables.customers[0].tags, 'new');
});

test('recruit_candidates.update accepts matching expectedUpdatedAt and rejects stale priority edits', async () => {
  store.tables.recruit_candidates = [{ id: 91, updated_at: 'R1', recruitment_priority: 'A' }];
  const saved = await recruits.main({ action: 'update', id: '91', data: { recruitment_priority: 'D' }, expectedUpdatedAt: 'R1' });
  assert.equal(saved.ok, true);
  assert.equal(store.tables.recruit_candidates[0].recruitment_priority, 'D');
  const stale = await recruits.main({ action: 'update', id: '91', data: { recruitment_priority: 'B' }, expectedUpdatedAt: 'R1' });
  assert.equal(stale.code, 'RECRUIT_CONFLICT');
  assert.equal(store.tables.recruit_candidates[0].recruitment_priority, 'D');
});
