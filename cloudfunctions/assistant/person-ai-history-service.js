/** Read recent AI outputs and legacy recommendations for one authenticated Person. */
'use strict';

const ALLOWED_TASKS = new Set(['person_summary', 'meeting_prep', 'conversation_playbook']);

function positiveId(value) { return /^[1-9][0-9]*$/.test(String(value || '')); }

async function restGet(table, filters) {
  const env = process.env.TCB_ENV;
  const key = process.env.CRM_ASSISTANT_DB_API_KEY;
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) throw new Error('DB not configured');
  const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
  for (const [name, value] of Object.entries(filters || {})) url.searchParams.set(name, String(value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}`,
      'Accept-Profile': 'public', 'Content-Profile': 'public', Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`REST ${table} failed (${response.status})`);
    const body = await response.text();
    return body ? JSON.parse(body) : [];
  } finally { clearTimeout(timer); }
}

function resultView(task, result) {
  const safeResult = result && typeof result === 'object' ? result : {};
  const fields = task.task_type === 'person_summary' ? ['summary','signals','gaps','nextActions','evidence'] :
    task.task_type === 'meeting_prep' ? ['brief30Seconds','recentChanges','suggestedObjective','openingAngles','possibleObjections','questionsToConfirm','avoid'] :
      ['possibleUnderlyingReasons','clarifyingQuestions','responseLogic','evidenceRefs','nextObjective','doNotSay'];
  const out = {};
  for (const key of fields) if (safeResult[key] !== undefined) out[key] = safeResult[key];
  const refs = []; const seen = new Set();
  const walk = (value, depth = 0) => {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) { value.slice(0, 50).forEach(item => walk(item, depth + 1)); return; }
    if (typeof value !== 'object') return;
    if (value.schema === 'public' && typeof value.table === 'string' && value.id != null) {
      const key = `${value.table}:${value.id}`;
      if (!seen.has(key) && /^[a-z_]+$/.test(value.table) && /^[1-9]\d*$/.test(String(value.id))) {
        seen.add(key); refs.push({ schema: 'public', table: value.table, id: String(value.id),
          label: value.label || (typeof value.source === 'string' ? value.source : '') });
      }
    }
    for (const [name, child] of Object.entries(value)) {
      if (name === 'raw_note') continue;
      if (name === 'reference' && child && typeof child === 'object') walk({ ...child,
        label: value.source || child.label }, depth + 1);
      else walk(child, depth + 1);
    }
  };
  walk(task.context_snapshot);
  return { id: String(task.id), taskType: task.task_type, skillVersion: task.context_snapshot?._context?.version || null,
    createdAt: task.created_at || null, result: out, sources: refs.slice(0, 30) };
}

function nbaView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = ['action','reason','priority','channel','goal','suggested_date','script','confidence','evidence',
    'assessment','next_action','topic','avoid','success_criteria'];
  const result = {};
  for (const field of fields) {
    const item = value[field];
    if (typeof item === 'string') result[field] = item.slice(0, 300);
    else if (Array.isArray(item)) result[field] = item.filter(x => typeof x === 'string').slice(0, 8).map(x => x.slice(0, 160));
  }
  return Object.keys(result).length ? result : null;
}

async function getPersonAIHistory(event, { read = restGet } = {}) {
  const personId = String(event?.personId || '').trim();
  if (!positiveId(personId)) { const error = new Error('personId must be a positive integer'); error.code = 'INVALID_INPUT'; throw error; }
  // Opt-in paged contract; requests without filters retain the original generated/legacy projection.
  if (Object.hasOwn(event, 'filters')) {
    const { validateHistory, readAIHistory } = require('./ai-history-query');
    const filters = validateHistory(event.filters);
    if (filters.personId && filters.personId !== personId) {
      const error = new Error('Person filter mismatch'); error.code = 'INVALID_INPUT'; throw error;
    }
    return { ok:true, format:'paged-v1', ...(await readAIHistory({...filters,personId},{read})) };
  }
  const people = await read('persons', { select: 'id', id: `eq.${personId}`, deleted_at: 'is.null', limit: 1 });
  if (!Array.isArray(people) || !people.length) { const error = new Error('Person not found'); error.code = 'NOT_FOUND'; throw error; }
  const [tasks, customers] = await Promise.all([
    read('ai_tasks', { select: 'id,task_type,status,created_at,context_snapshot',
      subject_type: 'eq.person', subject_id: `eq.${personId}`, task_type: 'in.(person_summary,meeting_prep,conversation_playbook)',
      status: 'eq.completed', order: 'created_at.desc,id.desc', limit: 15 }),
    read('customers', { select: 'Id', person_id: `eq.${personId}`, deleted_at: 'is.null', limit: 1 }),
  ]);
  const safeTasks = (Array.isArray(tasks) ? tasks : []).filter(task => ALLOWED_TASKS.has(task.task_type));
  const ids = safeTasks.map(task => String(task.id)).filter(id => /^[1-9]\d*$/.test(id));
  const results = ids.length ? await read('ai_results', { select: 'task_id,result_json', task_id: `in.(${ids.join(',')})`, limit: 15 }) : [];
  const resultByTask = new Map((Array.isArray(results) ? results : []).map(row => [String(row.task_id), row.result_json]));
  const generated = safeTasks.filter(task => resultByTask.has(String(task.id))).map(task =>
    resultView(task, resultByTask.get(String(task.id))));
  const customerId = customers?.[0]?.Id;
  const legacyRows = customerId ? await read('ai_recommendations', {
    select: 'id,created_at,recommendation_date,suggested_followup_date,suggested_message,suggested_strategy,suggested_customer_stage,suggested_followup_goal,nba',
    customer_id: `eq.${customerId}`, order: 'recommendation_date.desc.nullslast,id.desc', limit: 20,
  }) : [];
  return { ok: true, generated, legacy: (Array.isArray(legacyRows) ? legacyRows : []).map(row => ({
    id: String(row.id), createdAt: row.created_at || row.recommendation_date || null,
    recommendationDate: row.recommendation_date || null, suggestedFollowupDate: row.suggested_followup_date || null,
    suggestedMessage: String(row.suggested_message || '').slice(0, 4000),
    suggestedStrategy: String(row.suggested_strategy || '').slice(0, 4000),
    suggestedCustomerStage: row.suggested_customer_stage ? String(row.suggested_customer_stage).slice(0, 100) : null,
    suggestedFollowupGoal: String(row.suggested_followup_goal || '').slice(0, 500), nba: nbaView(row.nba),
    source: { schema: 'public', table: 'ai_recommendations', id: String(row.id) },
  })) };
}

module.exports = { getPersonAIHistory };
