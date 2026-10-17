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
  const sourceRows = {
    v_recruit_candidates: Array.from({ length: count }, (_, i) => ({
      candidate_id: String(1001 + i), next_action_date: i % 7 ? `2026-10-${String(17 - (i % 7)).padStart(2, '0')}` : null,
      customer_name: `legacy-${i}`,
    })),
    v_recruit_candidates_person_only: Array.from({ length: count }, (_, i) => ({
      candidate_id: String(2001 + i), next_action_date: i % 7 ? `2026-10-${String(17 - (i % 7)).padStart(2, '0')}` : null,
      customer_name: `person-${i}`,
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

test('PC31 Console pages incrementally and discloses the Person activity window in both languages', () => {
  const root = path.resolve(__dirname, '../..');
  const recruitPage = fs.readFileSync(path.join(root, 'crm/js/modules/console/pages/recruit.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(root, 'crm/js/modules/console/i18n.js'), 'utf8');
  assert.match(recruitPage, /data\.recruitDirectory\(ctx, \{ page, pageSize \}\)/);
  assert.match(recruitPage, /result\.hasMore/);
  assert.doesNotMatch(recruitPage, /pageSize:\s*1000/);
  assert.match(i18n, /已达 1000 条显示上限/);
  assert.match(i18n, /1,000 candidate cap/);
  assert.match(i18n, /最近 50 条沟通与跟进时间线记录/);
  assert.match(i18n, /50 most recent timeline items/);
});
