'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadService(folder, initial) {
  const rows = structuredClone(initial);
  const calls = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.orders = []; this.payload = null; this.mode = 'select'; this.bounds = null; }
    select(fields) { this.selectedFields = fields || null; return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    is(key, value) { this.filters.push([key, value]); return this; }
    order(key, options) { this.orders.push([key, options]); return this; }
    range(from, to) { this.bounds = [from, to]; return this; }
    limit(count) { this.bounds = [0, count - 1]; return this; }
    maybeSingle() { return Promise.resolve({ data: this.result()[0] || null }); }
    insert(payload) { this.payload = payload; this.mode = 'insert'; return this; }
    update(payload) { this.payload = payload; this.mode = 'update'; return this; }
    delete() { this.mode = 'delete'; return this; }
    result() {
      let found = rows[this.table].filter((row) => this.filters.every(([key, value]) => row[key] === value));
      for (const [key, options] of this.orders.slice().reverse()) {
        found = found.slice().sort((a, b) => {
          if (a[key] === b[key]) return 0;
          const direction = options?.ascending === false ? -1 : 1;
          return a[key] < b[key] ? -direction : direction;
        });
      }
      if (this.mode === 'update') {
        found.forEach((row) => Object.assign(row, this.payload));
        calls.push({ table: this.table, mode: this.mode, affected: found.length });
        return found.map((row) => ({ Id: row.Id, id: row.id }));
      }
      if (this.mode === 'delete') {
        const set = new Set(found);
        rows[this.table] = rows[this.table].filter((row) => !set.has(row));
        calls.push({ table: this.table, mode: this.mode, affected: found.length });
        return found.map((row) => ({ Id: row.Id, id: row.id }));
      }
      if (this.mode === 'insert') {
        const row = { ...this.payload, Id: 9001, id: 9001 };
        rows[this.table].push(row);
        calls.push({ table: this.table, mode: this.mode, affected: 1 });
        return [{ Id: row.Id, id: row.id }];
      }
      if (this.bounds) found = found.slice(this.bounds[0], this.bounds[1] + 1);
      if (this.selectedFields && this.mode === 'select') {
        const fields = this.selectedFields.split(',').map((field) => field.trim());
        found = found.map((row) => Object.fromEntries(fields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]])));
      }
      return found;
    }
    then(resolve, reject) { return Promise.resolve({ data: this.result() }).then(resolve, reject); }
  }
  const rdb = {
    from: (table) => new Query(table),
  };
  const fakeDb = {
    rdb,
    normFields: (input, fields) => Object.fromEntries(Object.entries(input).filter(([key]) => fields.includes(key))),
    assertOk: (response) => response,
  };
  const source = fs.readFileSync(path.join(__dirname, '../../cloudfunctions', folder, 'index.js'), 'utf8');
  const moduleObject = { exports: {} };
  vm.runInNewContext(source, {
    module: moduleObject,
    exports: moduleObject.exports,
    require(name) {
      if (name === './db') return fakeDb;
      throw new Error(`Unexpected dependency ${name}`);
    },
    console,
    Buffer,
    Number,
    Object,
    Array,
    String,
    Error,
  }, { filename: `${folder}/index.js` });
  return { main: moduleObject.exports.main, rows, calls };
}

test('gifts list pagination is additive and scoped gift writes reject mismatched customers', async () => {
  const service = loadService('gifts', { gifts: [
    { Id: 1, customer_id: 788, gift_name: 'test gift 1', deleted_at: null, given_date: '2026-10-10' },
    { Id: 2, customer_id: 788, gift_name: 'test gift 2', deleted_at: null, given_date: '2026-10-09' },
    { Id: 3, customer_id: 789, gift_name: 'other customer', deleted_at: null, given_date: '2026-10-08' },
  ] });
  const page = await service.main({ action: 'list', customer_id: 788, limit: 1, offset: 0 });
  assert.deepEqual(Array.from(page.rows, (row) => row.Id), [1]);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 1);
  const legacy = await service.main({ action: 'list', customer_id: 788 });
  assert.equal(Object.hasOwn(legacy, 'hasMore'), false);
  assert.equal(legacy.rows.length, 2);

  const before = service.rows.gifts.find((row) => row.Id === 1).gift_name;
  const mismatch = await service.main({ action: 'update', id: 1, customer_id: 789, data: { gift_name: 'cross-customer' } });
  assert.equal(mismatch.ok, false);
  assert.equal(service.rows.gifts.find((row) => row.Id === 1).gift_name, before);
  const removed = await service.main({ action: 'remove', id: 1, customer_id: 788 });
  assert.equal(removed.ok, true);
  assert.equal(service.rows.gifts.some((row) => row.Id === 1), false);
});

test('photos metadata pagination excludes base64; get/update/remove are customer-scoped and category is checked', async () => {
  const service = loadService('photos', { photos: [
    { id: 25, customer_id: 788, category: 'photo', sort_order: 0, file_name: 'test.jpg', photo_url: 'data:image/jpeg;base64,QQ==', photo_notes: null, deleted_at: null },
    { id: 26, customer_id: 788, category: 'attachment', sort_order: 1, file_name: 'test.txt', photo_url: 'data:text/plain;base64,QQ==', photo_notes: null, deleted_at: null },
    { id: 27, customer_id: 789, category: 'photo', sort_order: 0, file_name: 'other.jpg', photo_url: 'data:image/jpeg;base64,QQ==', photo_notes: null, deleted_at: null },
  ] });
  const page = await service.main({ action: 'list', customer_id: 788, limit: 1, offset: 0 });
  assert.deepEqual(Array.from(page.rows, (row) => row.id), [25]);
  assert.equal(Object.hasOwn(page.rows[0], 'photo_url'), false);
  assert.equal(page.hasMore, true);
  const mismatch = await service.main({ action: 'get', id: 25, customer_id: 789 });
  assert.equal(mismatch.error, 'not found');
  const photo = await service.main({ action: 'get', id: 25, customer_id: 788 });
  assert.equal(photo.photo.photo_url, 'data:image/jpeg;base64,QQ==');
  const updateMismatch = await service.main({ action: 'update', id: 25, customer_id: 789, data: { photo_notes: 'changed' } });
  assert.equal(updateMismatch.ok, false);
  const deleteMismatch = await service.main({ action: 'remove', id: 25, customer_id: 789 });
  assert.equal(deleteMismatch.ok, false);
  assert.equal(service.rows.photos.some((row) => row.id === 25), true);
  const invalidCategory = await service.main({ action: 'create', data: { customer_id: 788, image_base64: 'QQ==', category: 'activity' } });
  assert.equal(invalidCategory.error, 'invalid category');
  assert.equal(service.calls.some((call) => call.mode === 'insert'), false);
  assert.equal(service.calls.some((call) => call.args && Object.hasOwn(call.args, 'activity_id')), false);
});
