/** Query recent conversation_playbook result for a person from ai_tasks/ai_results. */
'use strict';

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

  const env = process.env.TCB_ENV;
  const key = process.env.CRM_ASSISTANT_DB_API_KEY;
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) throw new Error('DB not configured');

  const restGet = async (table, filters) => {
    const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
    for (const [name, value] of Object.entries(filters || {})) url.searchParams.set(name, value);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, 'Accept-Profile': 'public',
        Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`REST ${table} failed (${res.status})`);
    return res.json();
  };

  // Step 1: find latest completed conversation_playbook task for this person.
  const tasks = await restGet('ai_tasks', {
    select: 'id,input_snapshot,created_at',
    subject_type: 'eq.person',
    subject_id: `eq.${personId}`,
    task_type: 'eq.conversation_playbook',
    status: 'eq.completed',
    order: 'created_at.desc',
    limit: '1',
  });
  if (!Array.isArray(tasks) || !tasks.length) return { ok: true, hasResult: false };
  const task = tasks[0];

  // Step 2: fetch the result.
  const results = await restGet('ai_results', {
    select: 'result_json',
    task_id: `eq.${task.id}`,
    limit: '1',
  });
  if (!Array.isArray(results) || !results.length) return { ok: true, hasResult: false };
  const result = results[0].result_json;
  const input = task.input_snapshot || {};

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
    createdAt: task.created_at || null,
  };
}

module.exports = { getConversationPlaybookHistory };
