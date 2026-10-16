/** Query recent conversation_playbook result for a person from ai_tasks/ai_results. */
'use strict';

function positiveId(value) {
  return /^[1-9][0-9]*$/.test(String(value || ''));
}

async function restGet(table, filters) {
  const env = process.env.TCB_ENV;
  const key = process.env.CRM_ASSISTANT_DB_API_KEY;
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) throw new Error('DB not configured');
  const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
  for (const [name, value] of Object.entries(filters || {})) url.searchParams.set(name, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let response;
  try { response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, 'Accept-Profile': 'public', Accept: 'application/json' },
    signal: controller.signal,
  }); } finally { clearTimeout(timer); }
  if (!response.ok) throw new Error(`REST ${table} failed (${response.status})`);
  return response.json();
}

async function getConversationPlaybookHistory(event, { read = restGet } = {}) {
  const personId = String(event?.personId || '').trim();
  if (!positiveId(personId)) {
    const e = new Error('personId must be a positive integer');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  // Step 1: find latest completed conversation_playbook task for this person.
  const tasks = await read('ai_tasks', {
    select: 'id,input_snapshot,context_snapshot,created_at',
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
  const results = await read('ai_results', {
    select: 'result_json',
    task_id: `eq.${task.id}`,
    limit: '1',
  });
  if (!Array.isArray(results) || !results.length) return { ok: true, hasResult: false };
  const result = results[0].result_json && typeof results[0].result_json === 'object' ? results[0].result_json : {};
  const input = task.input_snapshot || {};
  const refs = new Set((Array.isArray(result.evidenceRefs) ? result.evidenceRefs : []).map(String));
  const evidence = Array.isArray(task.context_snapshot?.reliable_evidence) ? task.context_snapshot.reliable_evidence : [];
  const citedEvidence = evidence.filter(row => refs.has(String(row.id ?? row.reference?.id)));

  return {
    ok: true,
    hasResult: true,
    objection: input.objection || '',
    possibleUnderlyingReasons: result.possibleUnderlyingReasons,
    clarifyingQuestions: result.clarifyingQuestions,
    responseLogic: result.responseLogic,
    evidenceRefs: citedEvidence.map(row => Number(row.id ?? row.reference?.id)).filter(Number.isSafeInteger),
    evidenceSources: citedEvidence.map(row => ({
      ...row.reference, label: row.source, source_date: row.source_date || null, confidence: row.confidence,
    })),
    nextObjective: result.nextObjective,
    doNotSay: result.doNotSay,
    createdAt: task.created_at || null,
  };
}

module.exports = { getConversationPlaybookHistory };
