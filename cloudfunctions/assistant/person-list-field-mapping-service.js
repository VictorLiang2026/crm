'use strict';

const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');

const ALLOWED = new Set(['display_name','phone','wechat','gender','birthday','occupation','organization','education',
  'source','hobbies','customer_stage','sales_priority','referral_priority','marital_status','first_contact_date','notes']);

async function mapPersonListFields(data, deps = {}) {
  const headers = data?.headers;
  const language = data?.language === 'en' ? 'en' : 'zh-CN';
  if (!Array.isArray(headers) || headers.length < 1 || headers.length > 100 ||
      headers.some(header => typeof header !== 'string' || !header.trim() || header.length > 120)) {
    const error = new Error('INVALID_INPUT'); error.code = 'INVALID_INPUT'; throw error;
  }
  const database = (deps.databaseFactory || createSearchData)({
    env: process.env.TCB_ENV, key: process.env.CRM_ASSISTANT_DB_API_KEY,
  });
  const gateway = (deps.gatewayFactory || createAIGateway)(
    { app: deps.app || require('./db').app, rdb: database.auditRdb, timeoutMs: 25000, maxAttempts: 1 });
  const task = await gateway.runAITask({
    taskType: 'person_list_field_mapping', skill: 'person_list_field_mapping', capability: 'analysis',
    input: { headers: headers.map(header => header.trim()), language }, context: {},
    contextSnapshot: { _context: { recipe: 'person_list_field_mapping', version: '1.0.0' } },
  });
  const received = new Map();
  for (const row of Array.isArray(task?.result?.mappings) ? task.result.mappings : []) {
    if (!Number.isInteger(row.columnIndex) || row.columnIndex < 0 || row.columnIndex >= headers.length ||
        received.has(row.columnIndex)) continue;
    received.set(row.columnIndex, {
      columnIndex: row.columnIndex,
      field: ALLOWED.has(row.field) ? row.field : null,
      confidence: Math.max(0, Math.min(100, Number(row.confidence) || 0)),
      reason: typeof row.reason === 'string' ? row.reason.slice(0, 240) : '',
    });
  }
  return {
    ok: true,
    mappings: headers.map((header, columnIndex) => received.get(columnIndex) ||
      { columnIndex, field: null, confidence: 0, reason: '' }),
    taskId: task?.taskId,
    resultId: task?.resultId,
    skillVersion: task?.skillVersion,
  };
}

module.exports = { mapPersonListFields, ALLOWED };
