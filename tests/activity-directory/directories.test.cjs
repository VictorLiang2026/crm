'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function service(name, tables) {
  const rdb = { from(table) {
    assert.ok(Object.hasOwn(tables, table), `unexpected table ${table}`);
    const filters = [], orders = [];
    let start = 0, end = Infinity;
    const q = {
      select() { return q; },
      is(key, value) { filters.push(row => row[key] == value); return q; },
      eq(key, value) { filters.push(row => row[key] === value); return q; },
      in(key, values) { filters.push(row => values.includes(row[key])); return q; },
      lt(key, value) { filters.push(row => row[key] != null && row[key] < value); return q; },
      gt(key, value) { filters.push(row => row[key] != null && row[key] > value); return q; },
      gte(key, value) { filters.push(row => row[key] != null && row[key] >= value); return q; },
      lte(key, value) { filters.push(row => row[key] != null && row[key] <= value); return q; },
      order(key, options) { orders.push([key, options]); return q; },
      range(first, last) { start = first; end = last + 1; return q; },
      limit(count) { end = count; return q; },
      then(resolve, reject) {
        return Promise.resolve().then(() => ({ data: tables[table].filter(row => filters.every(fn => fn(row)))
          .sort((a, b) => {
            for (const [key, options] of orders) {
              if (a[key] === b[key]) continue;
              if (a[key] == null) return 1;
              if (b[key] == null) return -1;
              return (a[key] < b[key] ? -1 : 1) * (options.ascending ? 1 : -1);
            }
            return 0;
          }).slice(start, end) })).then(resolve, reject);
      },
    };
    return q;
  } };
  const exports = {};
  const context = vm.createContext({ exports, require: dependency => {
    if (dependency === './db') return { rdb, assertOk: result => result };
    if (dependency === './resource-directory') return require(`../../cloudfunctions/${name}/resource-directory`);
    throw Error(`unexpected dependency ${dependency}`);
  } });
  new vm.Script(fs.readFileSync(path.resolve(__dirname, `../../cloudfunctions/${name}/index.js`), 'utf8')).runInContext(context);
  return event => exports.main(event, {});
}

test('activity directory searches beyond legacy 100, filters by date and sorts across pages', async () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({
    id: index + 1, name: `Fictional activity ${String(130 - index).padStart(3, '0')}`,
    activity_date: index < 65 ? '2026-10-29' : '2026-11-01',
    activity_type: 'salon', location: index === 0 ? 'Needle Place' : 'Fictional Place',
    status: index % 2 ? 'preparing' : 'confirmed',
    deleted_at: null,
  }));
  const call = service('activities', { activities: rows });
  const first = await call({ action: 'directory', page: 1, pageSize: 50, sortField: 'name', sortDir: 'asc' });
  const second = await call({ action: 'directory', page: 2, pageSize: 50, sortField: 'name', sortDir: 'asc' });
  assert.equal(first.rows.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 100);
  assert.equal(first.rows[0].name, 'Fictional activity 001');
  const filtered = await call({ action: 'directory', keyword: 'needle', startDate: '2026-10-29', endDate: '2026-10-29' });
  assert.deepEqual(Array.from(filtered.rows, row => row.id), [1]);
  const byLocation = await call({ action: 'directory', sortField: 'location', sortDir: 'desc', pageSize: 10 });
  assert.equal(byLocation.rows[0].location, 'Needle Place');
  const byStatus = await call({ action: 'directory', sortField: 'status', sortDir: 'asc', pageSize: 10 });
  assert.equal(byStatus.rows[0].status, 'confirmed');
  assert.equal((await call({ action: 'list' })).rows.length, 100);
  assert.match((await call({ action: 'directory', startDate: '2026-02-30' })).error, /Invalid activity directory/);
  assert.match((await call({ action: 'directory', startDate: '2026-11-01', endDate: '2026-10-01' })).error, /Invalid activity directory/);
  assert.match((await call({ action: 'directory', sortField: 'deleted_at' })).error, /Invalid activity directory/);
});

test('speaker name sort uses the displayed Person name before page slicing', async () => {
  const speakers = Array.from({ length: 61 }, (_, index) => ({
    id: index + 1, name: `Old ${String(index + 1).padStart(2, '0')}`, person_id: index + 1,
    updated_at: '2026-10-29', deleted_at: null, status: 'active', relationship_stage: 'new',
  }));
  const persons = speakers.map((row, index) => ({
    id: row.id, display_name: `Fictional ${String(61 - index).padStart(2, '0')}`,
    organization: 'Fictional School', deleted_at: null,
  }));
  const call = service('activity_speakers', { activity_speakers: speakers, persons });
  const first = await call({ action: 'directory', sortField: 'name', sortDir: 'asc', pageSize: 30 });
  const second = await call({ action: 'directory', sortField: 'name', sortDir: 'asc', page: 2, pageSize: 30 });
  assert.equal(first.rows[0].name, 'Fictional 01');
  assert.equal(second.rows[0].name, 'Fictional 31');
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 60);
  assert.equal((await call({ action: 'directory', sortField: 'name', sortDir: 'desc', pageSize: 30 })).rows[0].name, 'Fictional 61');
  assert.match((await call({ action: 'directory', sortField: 'unsafe' })).error, /Invalid resource directory/);
});

test('topic directory applies sort to the complete result before pagination', async () => {
  const topics = Array.from({ length: 65 }, (_, index) => ({
    id: index + 1, topic_name: `Fictional Topic ${String(65 - index).padStart(2, '0')}`,
    use_count: index, updated_at: '2026-10-29', deleted_at: null, status: 'active', keywords: [],
  }));
  const call = service('activity_topics', { activity_topics: topics });
  const first = await call({ action: 'directory', sortField: 'use_count', sortDir: 'desc', pageSize: 30 });
  const second = await call({ action: 'directory', sortField: 'use_count', sortDir: 'desc', page: 2, pageSize: 30 });
  assert.equal(first.rows[0].use_count, 64);
  assert.equal(second.rows[0].use_count, 34);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 60);
  assert.match((await call({ action: 'directory', sortDir: 'sideways' })).error, /Invalid resource directory/);
});
