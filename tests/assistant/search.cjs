'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMain } = require('../../cloudfunctions/assistant');
const { runSearch } = require('../../cloudfunctions/assistant/search-service');
const { createSearchData } = require('../../cloudfunctions/assistant/search-data');

test('search action keeps the old router and requires a real login', async () => {
  let calls = 0;
  const execute = async () => { calls++; return { ok: true, status: 'complete' }; };
  const anonymous = createMain(() => ({ uid: 'anon', isAnonymous: true }), execute);
  assert.equal((await anonymous({ action: 'search', query: 'test' })).error.code, 'UNAUTHORIZED');
  assert.equal(calls, 0);
  const authorized = createMain(() => ({ uid: 'user', isAnonymous: false }), execute);
  assert.equal((await authorized({ intent: 'search', input: { query: 'test' } })).status, 'routed');
  assert.equal((await authorized({ action: 'search', query: 'test' })).status, 'complete');
  assert.equal(calls, 1);
});

test('model chooses only a template; names and evidence come from the database', async () => {
  const modelResult = { template: 'activity_no_followup', months: 3 };
  const calls = [];
  const gateway = { runAITask: async request => {
    calls.push(request);
    return { taskId: 7, resultId: 8, result: modelResult };
  } };
  const data = { search: async (template, months, limit) => {
    assert.deepEqual([template, months, limit], ['activity_no_followup', 3, 30]);
    return { total: 1, coverage: { source: 'attended_participants', rows: 2 },
      rows: [{ person_id: 17, display_name: '[CRM_TEST_ONLY]甲', activity_id: 4,
        participant_id: 5, activity_date: '2026-09-20' }] };
  } };
  const response = await runSearch({ query: '最近三个月参加过活动但没有继续跟进的人' },
    { app: {}, gateway, data });
  assert.equal(response.rows[0].display_name, '[CRM_TEST_ONLY]甲');
  assert.equal(response.resultSource, 'public.crm_search_people_v1');
  assert.equal(response.execution.businessDataWritten, false);
  assert.equal(calls[0].context.guidance.rules.includes('Never output SQL'), true);
  assert.equal(JSON.stringify(calls[0]).includes('[CRM_TEST_ONLY]甲'), false);
});

test('unsupported model interpretation never runs a database search', async () => {
  let searched = false;
  const response = await runSearch({ query: '未知组合条件' }, {
    app: {}, data: { search: async () => { searched = true; } },
    gateway: { runAITask: async () => ({ taskId: 1, resultId: 2,
      result: { template: 'unsupported', months: 3 } }) },
  });
  assert.equal(response.status, 'unsupported');
  assert.equal(searched, false);
});

test('server adapter allows only audit writes and the fixed public search RPC', async () => {
  const calls = [];
  const adapter = createSearchData({ env: 'crm-d1gkae8ddc930d151', key: 'test-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options.method, body: options.body });
      return { ok: true, text: async () => options.method === 'POST' && String(url).includes('/rpc/')
        ? JSON.stringify({ total: 0, rows: [], coverage: { source: 'attended_participants', rows: 0 } })
        : JSON.stringify([{ id: 1 }]) };
    } });
  assert.throws(() => adapter.auditRdb.from('persons'), /Invalid AI audit table/);
  await assert.rejects(adapter.search('SELECT * FROM public.persons', 3, 30), /Invalid CRM search criteria/);
  const result = await adapter.search('activity_no_followup', 3, 30);
  assert.equal(result.total, 0);
  const audit = await adapter.auditRdb.from('ai_tasks').insert({ task_type: 'test' }).select('id');
  assert.deepEqual(audit.data, [{ id: 1 }]);
  assert.match(calls[0].url, /\/v1\/rdb\/rest\/rpc\/crm_search_people_v1$/);
  assert.equal(calls.some(call => call.url.includes('/persons')), false);
  assert.equal(JSON.stringify(result).includes('test-secret'), false);
});
