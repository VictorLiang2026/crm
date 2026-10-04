'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const marker = '【系统测试·勿联系】';

test('legacy report generation keeps a fictional marked customer and operator throughout the saved draft', async () => {
  let prompt = '', inserted, modelCalls = 0;
  const rows = { products: [], followups: [], gifts: [], policy_review_reports: [], photos: [] };
  function query(table) {
    let inserting = false;
    const api = {
      select() { return api; }, eq() { return api; }, is() { return api; },
      order() { return api; }, limit() { return api; },
      insert(value) { inserted = value; inserting = true; return api; },
      async maybeSingle() { return { data: table === 'customers' ?
        { Id: 788, customer_name: `${marker}虚构体验甲`, phone: null,
          additional_info: `${marker}纯虚构资料` } :
        (inserted ? { id: 41, ...inserted } : null) }; },
      then(resolve, reject) { return Promise.resolve({ data: inserting ? [{ id: 41 }] : rows[table] }).then(resolve, reject); },
    };
    return api;
  }
  const stub = {
    rdb: { from: query },
    generateText: async messages => {
      modelCalls++;
      prompt = JSON.stringify(messages);
      return { text: JSON.stringify({ summary: '虚构摘要', gaps_found: [{ fact: '虚构待核实问题' }],
        recommendations: ['虚构建议'], asset_allocation: '虚构配置', next_action: '虚构下一步' }) };
    },
    extractJson: JSON.parse,
    normFields: (value, fields) => Object.fromEntries(Object.entries(value).filter(([key]) => fields.includes(key))),
    assertOk: value => value,
    nowIso: () => '2026-10-04T00:00:00Z',
  };
  const original = Module._load;
  const target = require.resolve('../../cloudfunctions/policy_review_reports');
  delete require.cache[target];
  Module._load = function(name, parent, isMain) {
    if (name === './db' && parent?.filename === target) return stub;
    return original.call(this, name, parent, isMain);
  };
  let main;
  try { ({ main } = require(target)); }
  finally { Module._load = original; delete require.cache[target]; }
  const result = await main({ action: 'generate', customer_id: 788,
    operator: { name: '真实姓名', gender: '男', birthday: '1976-10' } });
  assert.equal(result.id, 41);
  assert.match(prompt, /虚构系统顾问/);
  assert.doesNotMatch(prompt, /真实姓名|Victor/);
  for (const field of ['summary', 'gaps_found', 'recommendations',
    'asset_allocation', 'next_action', 'raw', 'report_type']) {
    assert.ok(inserted[field]?.includes(marker), field);
  }
  assert.equal(inserted.customer_name, `${marker}虚构体验甲`);
  const replay = await main({ action: 'generate', customer_id: 788 });
  assert.equal(replay.id, 41);
  assert.equal(replay.replayed, true);
  assert.equal(modelCalls, 1);
});
