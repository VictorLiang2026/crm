/** Person summary: read public facts via RDB REST, call person_summary skill via AI Gateway. */
'use strict';

const { app } = require('./db');
const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');

function positiveId(value) {
  return /^[1-9][0-9]*$/.test(String(value || ''));
}

async function restGet(table, filters) {
  const env = process.env.TCB_ENV;
  const key = process.env.CRM_ASSISTANT_DB_API_KEY;
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) throw new Error('Database is not configured');
  const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
  for (const [name, value] of Object.entries(filters || {})) url.searchParams.set(name, String(value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, 'Accept-Profile': 'public',
        'Content-Profile': 'public', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`DB request failed (${response.status})`);
    const payload = await response.text();
    return payload ? JSON.parse(payload) : [];
  } finally { clearTimeout(timer); }
}

async function runSummarize(event) {
  const personId = String(event?.personId || '').trim();
  if (!positiveId(personId)) {
    const e = new Error('personId must be a positive integer');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  const persons = await restGet('persons', {
    select: 'id,display_name,occupation,organization',
    id: `eq.${personId}`, deleted_at: 'is.null', limit: 1,
  });
  const person = Array.isArray(persons) && persons[0];
  if (!person) {
    const e = new Error('Person not found');
    e.code = 'NOT_FOUND';
    throw e;
  }

  const interactions = await restGet('interactions', {
    select: 'id,interaction_type,interaction_at,channel,summary,importance',
    person_id: `eq.${personId}`, order: 'interaction_at.desc,id.desc', limit: 20,
  });

  const opps = await restGet('opportunities', {
    select: 'id,opportunity_type,status,next_action,discovered_at,updated_at',
    person_id: `eq.${personId}`, deleted_at: 'is.null',
    order: 'updated_at.desc,id.desc', limit: 10,
  });
  const openOpps = (Array.isArray(opps) ? opps : []).filter((o) => o.status !== '成交' && o.status !== '关闭');

  const context = {
    person: {
      id: person.id,
      display_name: person.display_name,
      occupation: person.occupation || null,
      organization: person.organization || null,
    },
    recent_interactions: (Array.isArray(interactions) ? interactions : []).map((i) => ({
      id: i.id, type: i.interaction_type, at: i.interaction_at,
      channel: i.channel, summary: i.summary, importance: i.importance,
    })),
    open_opportunities: openOpps.map((o) => ({
      id: o.id, type: o.opportunity_type, status: o.status,
      next_action: o.next_action, discovered_at: o.discovered_at,
    })),
  };

  const database = createSearchData({ env: process.env.TCB_ENV,
    key: process.env.CRM_ASSISTANT_DB_API_KEY });
  const aiGateway = createAIGateway({ app, rdb: database.auditRdb, timeoutMs: 30000, maxAttempts: 1 });
  const task = await aiGateway.runAITask({
    taskType: 'person_summary',
    skill: 'person_summary',
    capability: 'summarization',
    input: { personId },
    context,
    contextSnapshot: {
      ...context,
      _context: { recipe: 'person_summary', version: '1.0.0',
        source: 'public.persons + public.interactions + public.opportunities' },
    },
  });

  return {
    ok: true,
    personId,
    summary: task.result.summary,
    signals: task.result.signals,
    gaps: task.result.gaps,
    nextActions: task.result.nextActions,
    evidence: task.result.evidence,
    taskId: task.taskId,
    resultId: task.resultId,
    skillVersion: task.skillVersion,
    execution: { modelCalled: true, businessDataRead: true, businessDataWritten: false },
  };
}

module.exports = { runSummarize };
