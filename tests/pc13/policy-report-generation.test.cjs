'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('policy report generation records the product version and carries human revisions into AI history', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/policy_review_reports/index.js'), 'utf8');
  let inserted;
  let generationMessages;
  const history = [{
    id: 4, report_date: '2026-10-01', report_type: '旧检视',
    summary: 'AI 原摘要', gaps_found: 'AI 原缺口', recommendations: 'AI 原建议',
    asset_allocation: 'AI 原配置', next_action: 'AI 原行动',
    edited_summary: '人工摘要', edited_gaps: '人工核实内容', edited_recommendations: null,
    edited_asset_allocation: '', edited_next_action: '人工下一步',
  }];
  const rowsByTable = {
    customers: { Id: 788, customer_name: '虚构客户', person_id: null },
    products: [{ version: 6, current_policy_description: '【系统测试】虚构客户当前以医疗保障为主，待核实续保条件',
      items: JSON.stringify([{ key: 'ap_ci', coverage_amount: '100000', total_premium: '5000',
        paid_premium: '2000', annual_premium: '3000', update_date: '2026-10-01' }]) }],
    followups: [], gifts: [], policy_review_reports: history, photos: [],
  };
  class Query {
    constructor(table) { this.table = table; this.payload = null; }
    select() { return this; }
    eq() { return this; }
    is() { return this; }
    order() { return this; }
    limit() { return this; }
    insert(payload) { this.payload = payload; inserted = payload; return this; }
    async maybeSingle() {
      if (this.table === 'customers') return { data: rowsByTable.customers };
      if (this.table === 'policy_review_reports') return { data: { ...inserted, id: 99, created_at: '2026-10-16T00:00:00Z' } };
      return { data: null };
    }
    async then(resolve, reject) {
      if (this.payload) return resolve({ data: [{ id: 99 }] });
      return resolve({ data: rowsByTable[this.table] || [] });
    }
  }
  const db = {
    rdb: { from: (table) => new Query(table) },
    generateText: async (messages) => {
      generationMessages = messages;
      return { text: JSON.stringify({ summary: '新摘要', gaps_found: '新缺口', recommendations: '新建议' }) };
    },
    extractJson: (value) => JSON.parse(value),
    normFields: (value) => value,
    assertOk: (value) => {
      if (value?.error) throw new Error(value.error);
      return value;
    },
    nowIso: () => '2026-10-16T00:00:00Z',
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: (name) => name === './db' ? db : require(name),
    console, Date, JSON, Object, String, Number, Promise,
  }, { filename: 'policy_review_reports/index.js' });

  const result = await module.exports.main({ action: 'generate', customer_id: '788' });
  assert.equal(result.id, 99);
  assert.equal(inserted.input_products_version, 6);
  const userContent = generationMessages.find((message) => message.role === 'user').content;
  assert.match(userContent, /人工摘要/);
  assert.match(userContent, /人工核实内容/);
  assert.match(userContent, /人工下一步/);
  assert.match(userContent, /虚构客户当前以医疗保障为主/);
  assert.match(userContent, /"total_premium": "5000"/);
  assert.doesNotMatch(userContent, /AI 原摘要/);
  assert.equal(inserted.summary, '新摘要');
});
