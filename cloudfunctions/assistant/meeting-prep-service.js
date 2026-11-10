/** Meeting prep: fetch context from person_360, call meeting_prep skill via AI Gateway. */
'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const { app } = require('./db');
const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');

async function restGet(table, filters) {
  const env = process.env.TCB_ENV;
  const key = process.env.CRM_ASSISTANT_DB_API_KEY;
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) throw new Error('Database is not configured');
  const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
  for (const [name, value] of Object.entries(filters)) url.searchParams.set(name, String(value));
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

function positiveId(value) {
  return /^[1-9][0-9]*$/.test(String(value || ''));
}

async function runMeetingPrep(event, options = {}) {
  const personId = String(event?.personId || '').trim();
  if (!positiveId(personId)) {
    const e = new Error('personId must be a positive integer');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  const p360 = await (options.callFunction || (payload => require('./device-runtime').internalCall(app,payload)))({
    name: 'person_360',
    data: { action: 'getMeetingPrepContext', personId },
  });
  const context = p360 && p360.result;
  if (!context || typeof context !== 'object') {
    const e = new Error('Meeting prep context unavailable');
    e.code = 'UPSTREAM_UNAVAILABLE';
    throw e;
  }

  const database = options.database || createSearchData({ env: process.env.TCB_ENV,
    key: process.env.CRM_ASSISTANT_DB_API_KEY });
  const aiGateway = (options.gatewayFactory || createAIGateway)({
    app, rdb: database.auditRdb, timeoutMs: 100000, maxAttempts: 1 });
  const task = await aiGateway.runAITask({
    taskType: 'meeting_prep',
    skill: 'meeting_prep',
    capability: 'planning',
    subjectType: 'person',
    subjectId: personId,
    input: { person_id: personId },
    context,
    contextSnapshot: {
      ...context,
      _context: { recipe: 'meeting_prep', version: '2.0.0', source: 'person_360.getMeetingPrepContext' },
    },
    ...(typeof options.onStarted === 'function' ? { onStarted: options.onStarted } : {}),
  });

  return {
    ok: true,
    personId,
    brief30Seconds: task.result.brief30Seconds,
    recentChanges: task.result.recentChanges,
    suggestedObjective: task.result.suggestedObjective,
    openingAngles: task.result.openingAngles,
    possibleObjections: task.result.possibleObjections,
    questionsToConfirm: task.result.questionsToConfirm,
    avoid: task.result.avoid,
    sources: [
      ...(context.reliable_evidence || []).map(item => ({ ...item.reference, label: item.source, at: item.source_date || null })),
      ...(context.facts || []).map(item => ({ ...item.source, label: item.category || 'fact', at: item.last_verified_at || null })),
      ...(context.recent_interactions || []).map(item => ({ ...item.source, label: item.summary || item.type || 'interaction', at: item.at || null })),
    ],
    taskId: task.taskId,
    resultId: task.resultId,
    skillVersion: task.skillVersion,
    execution: { modelCalled: true, businessDataRead: true, businessDataWritten: false },
  };
}

async function getMeetingPrepTaskStatus(event, { read = restGet } = {}) {
  const personId = String(event?.personId || '').trim();
  const taskId = String(event?.taskId || '').trim();
  if (!positiveId(personId) || (taskId && !positiveId(taskId))) {
    const error = new Error('Valid personId and optional taskId are required'); error.code = 'INVALID_INPUT'; throw error;
  }
  let startedAt;
  if (!taskId && event?.startedAt !== undefined) {
    const parsed = Date.parse(event.startedAt);
    if (typeof event.startedAt !== 'string' || !Number.isFinite(parsed)) {
      const error = new Error('Invalid startedAt'); error.code = 'INVALID_INPUT'; throw error;
    }
    startedAt = new Date(parsed - 5000).toISOString();
  }
  const [people, tasks] = await Promise.all([
    read('persons', { select: 'id', id: `eq.${personId}`, deleted_at: 'is.null', limit: 1 }),
    read('ai_tasks', { select: 'id,task_type,status,subject_type,subject_id,created_at,context_snapshot',
      task_type: 'eq.meeting_prep', subject_type: 'eq.person', subject_id: `eq.${personId}`,
      ...(taskId ? { id: `eq.${taskId}` } : { order: 'created_at.desc,id.desc' }),
      ...(startedAt ? { created_at: `gte.${startedAt}` } : {}), limit: 1 }),
  ]);
  if (!Array.isArray(people) || !people.length) {
    const error = new Error('Person not found'); error.code = 'NOT_FOUND'; throw error;
  }
  const task = Array.isArray(tasks) ? tasks[0] : null;
  if (!task) {
    if (taskId) { const error = new Error('AI task not found'); error.code = 'NOT_FOUND'; throw error; }
    return { ok: true, status: startedAt ? 'starting' : 'none' };
  }
  const currentId = String(task.id);
  const base = { taskId: currentId, personId, createdAt: task.created_at || null };
  if (task.status === 'failed') {
    const runs = await read('ai_runs', { select: 'error', task_id: `eq.${currentId}`,
      order: 'created_at.desc,id.desc', limit: 1 });
    const code = runs?.[0]?.error === 'TIMEOUT' ? 'TIMEOUT' : 'AI_REQUEST_FAILED';
    return { ok: false, status: 'failed', ...base, error: { code } };
  }
  if (task.status !== 'completed') return { ok: true, status: 'pending', ...base };
  const results = await read('ai_results', { select: 'id,result_json', task_id: `eq.${currentId}`,
    order: 'rank.asc,id.asc', limit: 1 });
  const result = results?.[0]?.result_json;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    const error = new Error('AI result unavailable'); error.code = 'AI_AUDIT_UNKNOWN'; throw error;
  }
  const context = task.context_snapshot || {};
  return { ok: true, status: 'completed', ...base, resultId: String(results[0].id),
    brief30Seconds: result.brief30Seconds, recentChanges: result.recentChanges,
    suggestedObjective: result.suggestedObjective, openingAngles: result.openingAngles,
    possibleObjections: result.possibleObjections, questionsToConfirm: result.questionsToConfirm,
    avoid: result.avoid,
    sources: [
      ...(context.reliable_evidence || []).map(item => ({ ...item.reference, label: item.source, at: item.source_date || null })),
      ...(context.facts || []).map(item => ({ ...item.source, label: item.category || 'fact', at: item.last_verified_at || null })),
      ...(context.recent_interactions || []).map(item => ({ ...item.source, label: item.summary || item.type || 'interaction', at: item.at || null })),
    ], skillVersion: context._skill?.version || '2.0.0',
    execution: { modelCalled: true, businessDataRead: true, businessDataWritten: false } };
}

module.exports = { runMeetingPrep, getMeetingPrepTaskStatus };
