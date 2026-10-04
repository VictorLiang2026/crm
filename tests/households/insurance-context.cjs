'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === '@cloudbase/node-sdk') return { init: () => ({ auth: () => ({ getUserInfo: () => ({ uid: '' }) }) }) };
  return originalLoad.call(this, name, parent, isMain);
};
const { createService, main } = require('../../cloudfunctions/person_360');
Module._load = originalLoad;

function fixture(customerId = 101) {
  const calls = [];
  const rows = {
    persons: [{ id: 11, display_name: '【系统测试·勿联系】虚构甲', legacy_customer_id: customerId }],
    products: [{ id: 1, created_at: '2026-09-19T00:00:00Z',
      items: JSON.stringify([{ key: 'ap_ci', amount: '100000', premium: '3000', update_date: '2026-09-20' }]) }],
    policy_review_reports: [{ id: 2, report_date: '2026-09-20', summary: 'AI 摘要',
      edited_summary: '人工摘要', gaps_found: 'AI 缺口', edited_gaps: '人工确认待讨论的问题',
      edited_next_action: '准备资料', updated_at: '2026-09-21T00:00:00Z' }],
    ocr_records: [{ id: 3, summary: '保险合同摘要', raw_text: 'MUST_NOT_READ',
      file_ids: '[4]', file_names: '["保险合同.pdf"]' }],
    photos: [{ id: 4, file_name: '保险合同.pdf', category: 'attachment', photo_url: 'MUST_NOT_READ' }],
    opportunities: [{ id: 5, opportunity_type: 'insurance', status: '沟通',
      next_action: '核对虚构资料', next_action_date: '2026-09-30',
      updated_at: '2026-09-21T00:00:00Z' },
    { id: 6, opportunity_type: 'recruit', status: '发现' }],
    actions: [{ id: 7, opportunity_id: 5, title: '核对保单', due_at: '2026-09-30T00:00:00Z' }],
    crm_opportunity_action_links: [],
    interactions: [{ id: 8, summary: '【系统测试·勿联系】希望比较虚构养老保障方案',
      interaction_at: '2026-09-20T00:00:00Z' }],
    context_items: [],
  };
  const request = async (table, method, filters) => {
    calls.push({ table, method, filters });
    assert.equal(method, 'GET');
    if (table === 'persons') return rows.persons;
    if (table === 'opportunities' && filters.customer_id) return rows.opportunities;
    return rows[table] || [];
  };
  return { service: createService({ request,
    disclosure: async refs => ({ status: 'verified', containsTestData: true,
      recordCount: refs.length, sources: [{ batchKey: 'crm_test_main_v1', table: 'persons', count: 1 }] }),
  }), calls, rows };
}

test('anonymous insurance context fails before any database access', async () => {
  assert.deepEqual(await main({ action: 'getInsuranceContext', personId: 11 }), { error: 'UNAUTHORIZED' });
});

test('insurance context merges existing sources without raw files, OCR text or duplicate action', async () => {
  const { service, calls } = fixture();
  const result = await service.getInsuranceContext(11);
  assert.equal(result.existingCoverage[0].label, '医疗(CI)');
  assert.equal(result.existingCoverage[0].observedAt, '2026-09-20');
  assert.deepEqual(result.existingCoverage[0].source, { type: 'products', id: 1 });
  assert.equal(result.review.latest.summary, '人工摘要');
  assert.equal(result.review.ocr.length, 1);
  assert.equal(result.review.evidence[0].fileName, '保险合同.pdf');
  assert.equal(result.knownNeeds[0].source.type, 'interactions');
  assert.match(result.knownNeeds[0].content, /希望比较/);
  assert.equal(result.potentialGaps[0].content, '人工确认待讨论的问题');
  assert.equal(result.potentialGaps[0].source.type, 'policy_review_reports');
  assert.equal(result.evidenceStatus, 'recorded');
  assert.deepEqual(result.openOpportunities.map(row => row.id), [5]);
  assert.deepEqual(result.nextActions.map(row => row.title), ['核对保单']);
  assert.equal(result.testData.containsTestData, true);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(!calls.some(call => /photo_url|raw_text|customer_snapshot|\braw\b/.test(call.filters.select || '')));
  assert.ok(!JSON.stringify(result).includes('MUST_NOT_READ'));
});

test('Person without legacy customer reads only Person opportunities and actions', async () => {
  const { service, calls } = fixture(null);
  const result = await service.getInsuranceContext(11);
  assert.equal(result.existingCoverage.length, 0);
  assert.equal(result.review.latest, null);
  assert.ok(!calls.some(call => ['products', 'policy_review_reports', 'ocr_records', 'photos'].includes(call.table)));
});

test('no coverage or evidence never promotes a report gap into a fact', async () => {
  const { service, rows } = fixture();
  rows.products = []; rows.ocr_records = []; rows.photos = [];
  const result = await service.getInsuranceContext(11);
  assert.equal(result.evidenceStatus, 'unknown');
  assert.deepEqual(result.potentialGaps, []);
  assert.equal(result.review.latest.provenance, '人工编辑，仍需核实');
});

test('WP10 association contributes one actionable item without changing Action identity', async () => {
  const { service, rows } = fixture();
  rows.actions.push({ id: 9, opportunity_id: null,
    title: '【系统测试·勿联系】核对虚构保单', due_at: '2026-10-10T00:00:00Z' });
  rows.crm_opportunity_action_links.push({ action_id: 9, opportunity_id: 5 });
  const result = await service.getInsuranceContext(11);
  assert.deepEqual(result.nextActions.map(row => row.source.id), [7, 9]);
  assert.equal(rows.actions[1].opportunity_id, null);
});
