'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RecruitDirectoryService } = require('../../cloudfunctions/person_360/recruit-directory-service');

function ordered(rows) {
  return [...rows].sort((a, b) => {
    const ad = a.next_action_date || '', bd = b.next_action_date || '';
    if (ad !== bd) return bd.localeCompare(ad);
    return BigInt(a.candidate_id) > BigInt(b.candidate_id) ? -1 : 1;
  });
}

function fixture(count = 75) {
  const calls = [];
  const stages = ['新增人才', '互动暖客', '初次面谈', '增员活动', '精准面谈', '入职申请', '签约入司', '流失'];
  const sourceRows = {
    v_recruit_candidates: Array.from({ length: count }, (_, i) => ({
      candidate_id: String(1001 + i), next_action_date: i % 7 ? `2026-10-${String(17 - (i % 7)).padStart(2, '0')}` : null,
      customer_name: `legacy-${i}`, stage: stages[i % stages.length], recruitment_priority: ['A', 'B', 'C', 'D', 'E'][i % 5],
      potential_score: i % 100, idle_days: i % 30, updated_at: `2026-10-${String(1 + (i % 17)).padStart(2, '0')}T00:00:00Z`,
      person_id: String(3001 + i), customer_id: String(4001 + i), occupation: 'Engineer', next_action: `action-${i}`,
    })),
    v_recruit_candidates_person_only: Array.from({ length: count }, (_, i) => ({
      candidate_id: String(2001 + i), next_action_date: i % 7 ? `2026-10-${String(17 - (i % 7)).padStart(2, '0')}` : null,
      customer_name: `person-${i}`, stage: stages[(i + 3) % stages.length], recruitment_priority: ['E', 'D', 'C', 'B', 'A'][i % 5],
      potential_score: (count - i) % 100, idle_days: (count - i) % 30, updated_at: `2026-10-${String(1 + (i % 17)).padStart(2, '0')}T00:00:00Z`,
      person_id: String(5001 + i), customer_id: null, occupation: 'Teacher', next_action: `follow-up-${i}`,
    })),
  };
  const request = async (table, method, filters) => {
    calls.push({ table, method, filters });
    let rows = ordered(sourceRows[table]);
    if (filters.or) {
      const match = /next_action_date\.lt\.(\d{4}-\d{2}-\d{2}),and\(next_action_date\.eq\.\d{4}-\d{2}-\d{2},candidate_id\.lt\.(\d+)\),next_action_date\.is\.null/.exec(filters.or);
      assert.ok(match, `unexpected keyset filter: ${filters.or}`);
      const [, date, id] = match;
      rows = rows.filter(row => row.next_action_date == null || row.next_action_date < date ||
        (row.next_action_date === date && BigInt(row.candidate_id) < BigInt(id)));
    } else if (filters.next_action_date === 'is.null') {
      const id = filters.candidate_id.slice(3);
      rows = rows.filter(row => row.next_action_date == null && BigInt(row.candidate_id) < BigInt(id));
    }
    if (filters.customer_name) {
      const needle = filters.customer_name.replace(/^ilike\.\*/, '').replace(/\*$/, '').replace(/\\(.)/g, '$1').toLowerCase();
      rows = rows.filter(row => row.customer_name.toLowerCase().includes(needle));
    }
    if (filters.stage?.startsWith('in.(')) {
      const values = filters.stage.slice(4, -1).split(',');
      rows = rows.filter(row => values.includes(row.stage));
    }
    if (filters.recruitment_priority?.startsWith('in.(')) {
      const values = filters.recruitment_priority.slice(4, -1).split(',');
      rows = rows.filter(row => values.includes(row.recruitment_priority));
    }
    return rows.slice(0, Number(filters.limit));
  };
  return { service: new RecruitDirectoryService({ request }), calls, sourceRows };
}

test('PC31 merged recruit pages have a shared stable order and no gaps or duplicates', async () => {
  const f = fixture();
  const pages = [];
  let cursor = null;
  for (let page = 1; page <= 3; page += 1) {
    const result = await f.service.list({ page, pageSize: 50, cursor });
    pages.push(...result.rows);
    cursor = result.cursor;
    assert.equal(result.page, page);
    assert.equal(result.truncated, false);
  }
  const expected = ordered([
    ...f.sourceRows.v_recruit_candidates.map(row => ({ ...row, source: 'legacy' })),
    ...f.sourceRows.v_recruit_candidates_person_only.map(row => ({ ...row, source: 'person' })),
  ]);
  assert.deepEqual(pages.map(row => `${row.source}:${row.candidate_id}`),
    expected.map(row => `${row.source}:${row.candidate_id}`));
  assert.equal(new Set(pages.map(row => `${row.source}:${row.candidate_id}`)).size, pages.length);
  assert.ok(f.calls.every(call => call.filters.order === 'next_action_date.desc.nullslast,candidate_id.desc'));
  assert.ok(f.calls.every(call => call.filters.limit === 51));
  assert.ok(f.calls.slice(2).every(call => call.filters.or || call.filters.next_action_date === 'is.null'));
  assert.ok(pages.every(row => !('_source' in row)));
});

test('PC31 marks the bounded directory as truncated at 1,000 rows', async () => {
  const f = fixture(1100);
  let cursor = null;
  let result;
  for (let page = 1; page <= 20; page += 1) {
    result = await f.service.list({ page, pageSize: 50, cursor });
    cursor = result.cursor;
  }
  assert.equal(result.rows.length, 50);
  assert.equal(result.hasMore, true);
  assert.equal(result.truncated, true);
  assert.ok(f.calls.every(call => call.filters.limit === 51));
});

test('PC31 rejects pages beyond the explicit result cap', async () => {
  const f = fixture();
  await assert.rejects(() => f.service.list({ page: 21, pageSize: 50 }), /Invalid recruit directory page/);
  assert.equal(f.calls.length, 0);
});

test('recruit directory search, multi-select filters, sorting, and 30-row paging span both sources', async () => {
  const f = fixture();
  const first = await f.service.list({
    page: 1, pageSize: 30, search: 'legacy', stages: ['新增人才', '初次面谈'],
    priorities: ['A', 'C'], sortField: 'potential_score', sortDir: 'asc',
  });
  assert.ok(first.rows.length > 0);
  assert.ok(first.rows.length <= 30);
  assert.equal(first.page, 1);
  assert.equal(first.pageSize, 30);
  assert.equal(first.total, 8);
  assert.equal(first.totalPages, 1);
  assert.ok(first.rows.every(row => row.customer_name.startsWith('legacy-')));
  assert.ok(first.rows.every(row => ['新增人才', '初次面谈'].includes(row.stage)));
  assert.ok(first.rows.every(row => ['A', 'C'].includes(row.recruitment_priority)));
  assert.deepEqual(first.rows.map(row => row.potential_score), [...first.rows.map(row => row.potential_score)].sort((a, b) => a - b));
  assert.ok(f.calls.every(call => call.filters.limit === 1000));
  assert.ok(f.calls.every(call => call.filters.order === 'potential_score.asc.nullslast,candidate_id.asc'));
  assert.ok(f.calls.every(call => call.filters.stage === 'in.(新增人才,初次面谈)'));
  assert.ok(f.calls.every(call => call.filters.recruitment_priority === 'in.(A,C)'));

  const all = fixture();
  const page1 = await all.service.list({ page: 1, pageSize: 30, sortField: 'name', sortDir: 'asc' });
  const page2 = await all.service.list({ page: 2, pageSize: 30, sortField: 'name', sortDir: 'asc' });
  assert.equal(page1.rows.length, 30);
  assert.equal(page2.rows.length, 30);
  assert.equal(page2.page, 2);
  assert.equal(page1.total, 150);
  assert.deepEqual(page1.rows.concat(page2.rows).map(row => row.customer_name),
    [...page1.rows, ...page2.rows].map(row => row.customer_name).sort((a, b) => a.localeCompare(b, 'zh-CN', { sensitivity: 'base' })));
});

test('recruit directory rejects unsupported filters and sorting fields', async () => {
  const f = fixture();
  await assert.rejects(() => f.service.list({ page: 1, pageSize: 30, sortField: 'person_id' }), /Invalid recruit directory criteria/);
  await assert.rejects(() => f.service.list({ page: 1, pageSize: 30, stages: ['unexpected'] }), /Invalid recruit directory stages/);
  assert.equal(f.calls.length, 0);
});

test('recruit directory supports sorting every visible table column', async () => {
  const fields = {
    name: 'customer_name', stage: 'stage', recruitment_priority: 'recruitment_priority',
    potential_score: 'potential_score', next_action_date: 'next_action_date',
    idle_days: 'idle_days', updated_at: 'updated_at', candidate_id: 'candidate_id',
  };
  for (const [sortField, column] of Object.entries(fields)) {
    const f = fixture();
    const result = await f.service.list({ page: 1, pageSize: 30, sortField, sortDir: 'desc' });
    assert.equal(result.rows.length, 30, `${sortField} page size`);
    assert.ok(f.calls.every(call => call.filters.order === `${column}.desc.nullslast,candidate_id.desc`), `${sortField} query order`);
  }
});

test('Console recruit page provides sortable table, search, filters, and 30-row paging in both languages', () => {
  const root = path.resolve(__dirname, '../..');
  const recruitPage = fs.readFileSync(path.join(root, 'crm/js/modules/console/pages/recruit.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(root, 'crm/js/modules/console/i18n.js'), 'utf8');
  assert.match(recruitPage, /RECRUIT_PAGE_SIZE = 30/);
  assert.match(recruitPage, /search: state\.keyword/);
  assert.match(recruitPage, /stages: state\.stages, priorities: state\.priorities/);
  assert.match(recruitPage, /sortable-th/);
  assert.match(recruitPage, /previousButton/);
  assert.match(recruitPage, /nextButton/);
  assert.match(i18n, /搜索姓名/);
  assert.match(i18n, /Search names/);
  assert.match(i18n, /阶段停留天数/);
  assert.match(i18n, /Days in Stage/);
  assert.doesNotMatch(recruitPage, /recruit_directory_load_more/);
  assert.doesNotMatch(recruitPage, /pageSize:\s*1000/);
  assert.match(i18n, /1,000 candidate cap/);
  assert.match(i18n, /每次读取 20 条/);
  assert.match(i18n, /20 at a time/);
});
