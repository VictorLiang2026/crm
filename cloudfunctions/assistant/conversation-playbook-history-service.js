/** Query recent conversation_playbook result for a person from ai_tasks/ai_results. */
'use strict';

const { createSearchData } = require('./search-data');

function positiveId(value) {
  return /^[1-9][0-9]*$/.test(String(value || ''));
}

async function getConversationPlaybookHistory(event) {
  const personId = String(event?.personId || '').trim();
  if (!positiveId(personId)) {
    const e = new Error('personId must be a positive integer');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  const database = createSearchData({ env: process.env.TCB_ENV,
    key: process.env.CRM_ASSISTANT_DB_API_KEY });
  const rows = await database.auditRdb
    .from('ai_results')
    .select('result_json, ai_tasks!inner(input_snapshot, created_at)')
    .eq('ai_tasks.subject_type', 'person')
    .eq('ai_tasks.subject_id', personId)
    .eq('ai_tasks.task_type', 'conversation_playbook')
    .eq('ai_tasks.status', 'completed')
    .order('created_at', { foreignTable: 'ai_tasks', ascending: false })
    .limit(1);

  if (!rows || !rows.length) return { ok: true, hasResult: false };
  const row = rows[0];
  const result = row.result_json;
  const input = row.ai_tasks?.input_snapshot || {};
  return {
    ok: true,
    hasResult: true,
    objection: input.objection || '',
    possibleUnderlyingReasons: result.possibleUnderlyingReasons,
    clarifyingQuestions: result.clarifyingQuestions,
    responseLogic: result.responseLogic,
    evidenceRefs: result.evidenceRefs,
    nextObjective: result.nextObjective,
    doNotSay: result.doNotSay,
    createdAt: row.ai_tasks?.created_at || null,
  };
}

module.exports = { getConversationPlaybookHistory };
