/** CRM Search: AI selects a bounded template; public SQL returns the actual people. */
'use strict';

const { createAIGateway } = require('./ai-gateway');
const testData = require('./test-data');
const { createSearchData } = require('./search-data');

const GUIDANCE = Object.freeze({
  templates: {
    activity_no_followup: 'Actual attended status within the requested months, with no recorded follow-up since the latest attended activity. Invitation is not attendance.',
    child_education_no_insurance: 'Confirmed child household link, recent education mention or confirmed education item, and no recorded insurance discussion or coverage review.',
    declining_priority: 'Priority A/B customer with an explicitly declining relationship trend updated within the requested months.',
    unsupported: 'Use when the request does not fit one of the three fixed templates or is ambiguous. Do not invent another filter.',
  },
  rules: 'Return only template and months. A month count must be 1..12; default to 3 if unspecified. Never output SQL, person names, IDs, counts or search results. Absence of records is not proof that an event never happened.',
});

function queryOf(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) {
    const error = new Error('Search query must be 1 to 1000 characters');
    error.code = 'INVALID_INPUT';
    throw error;
  }
  return value.trim();
}

async function runSearch(event, { app, data, gateway } = {}) {
  const query = queryOf(event?.query);
  const database = data || createSearchData({ env: process.env.TCB_ENV,
    key: process.env.CRM_ASSISTANT_DB_API_KEY });
  const client = app || require('@cloudbase/node-sdk').init({ env: process.env.TCB_ENV });
  const aiGateway = gateway || createAIGateway({ app: client, rdb: database.auditRdb,
    timeoutMs: 30000, maxAttempts: 1 });
  const context = { guidance: GUIDANCE };
  const task = await aiGateway.runAITask({
    taskType: 'crm_search_parse', skill: 'crm_search_parse', capability: 'structured_extraction',
    input: { query }, context,
    contextSnapshot: { ...context, _context: { recipe: 'crm_search_templates', version: '1.0.0',
      source: 'fixed public schema query contract' } },
  });
  const { template, months } = task.result;
  if (template === 'unsupported') {
    return { ok: true, status: 'unsupported', taskId: task.taskId, resultId: task.resultId,
      criteria: { template, months }, total: 0, rows: [],
      notice: '当前仅支持活动到场未跟进、子女教育未见保险记录、重点客户关系下降三类组合查询。请改写问题。',
      execution: { modelCalled: true, businessDataRead: false, businessDataWritten: false } };
  }
  const found = await database.search(template, months, 30);
  const refs = found.rows.flatMap(row => [
    ['persons',row.person_id],['customers',row.legacy_customer_id],['activity_participants',row.participant_id],
    ['activities',row.activity_id],['household_members',row.child_member_id],['relationships',row.relationship_id],
    [row.education_source_table,row.education_source_id],
  ].filter(([table,id]) => testData.TABLES.has(table) && id != null).map(([table,id]) => ({table,id:String(id)})));
  const disclosure = await (database.testDataReader || testData.disclose)(refs);
  const notices = [];
  if (found.total > found.rows.length) notices.push('测试来源提示仅核对当前返回名单及其证据；未显示结果的测试来源尚未核验。');
  if (found.coverage.rows === 0) {
    notices.push({
      activity_no_followup: '所选时间内没有记录为“已参加”的活动人员；“已邀请”不算到场。',
      child_education_no_insurance: '尚无已确认的子女家庭关系；不能依据备注猜测谁有孩子。',
      declining_priority: '所选时间内没有明确记录为下降的关系趋势。',
    }[template]);
  }
  if (template === 'child_education_no_insurance') {
    notices.push('“未见保险记录”仅指所检查的 CRM 来源未记录相关沟通或检视，不能证明从未谈过。');
  }
  return { ok: true, status: 'complete', taskId: task.taskId, resultId: task.resultId,
    criteria: { template, months }, total: found.total, rows: found.rows,
    testData: disclosure, coverage: found.coverage, notices, resultSource: 'public.crm_search_people_v1',
    execution: { modelCalled: true, businessDataRead: true, businessDataWritten: false } };
}

module.exports = { runSearch, queryOf, GUIDANCE };
