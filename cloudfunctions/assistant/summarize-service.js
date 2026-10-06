/** Person summary: read public facts, call person_summary skill via AI Gateway. */
'use strict';

const { app, rdb } = require('./db');
const { createAIGateway } = require('./ai-gateway');

function positiveId(value) {
  return /^[1-9][0-9]*$/.test(String(value || ''));
}

async function runSummarize(event) {
  const personId = String(event?.personId || '').trim();
  if (!positiveId(personId)) {
    const e = new Error('personId must be a positive integer');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  const id = Number(personId);

  const personRes = await rdb.from('persons').select(
    'id,display_name,occupation,organization,legacy_customer_id'
  ).eq('id', id).is('deleted_at', null).limit(1);
  if (personRes && personRes.error) throw personRes.error;
  const person = personRes && personRes.data && personRes.data[0];
  if (!person) {
    const e = new Error('Person not found');
    e.code = 'NOT_FOUND';
    throw e;
  }

  const interactionsRes = await rdb.from('interactions').select(
    'id,interaction_type,interaction_at,channel,summary,importance'
  ).eq('person_id', id).order('interaction_at', { ascending: false }).limit(20);
  if (interactionsRes && interactionsRes.error) throw interactionsRes.error;

  const oppsRes = await rdb.from('opportunities').select(
    'id,opportunity_type,status,next_action,discovered_at,updated_at'
  ).eq('person_id', id).is('deleted_at', null).order('updated_at', { ascending: false }).limit(10);
  if (oppsRes && oppsRes.error) throw oppsRes.error;
  const openOpps = (oppsRes.data || []).filter((o) => o.status !== '成交' && o.status !== '关闭');

  const context = {
    person: {
      id: person.id,
      display_name: person.display_name,
      occupation: person.occupation || null,
      organization: person.organization || null,
    },
    recent_interactions: (interactionsRes.data || []).map((i) => ({
      id: i.id,
      type: i.interaction_type,
      at: i.interaction_at,
      channel: i.channel,
      summary: i.summary,
      importance: i.importance,
    })),
    open_opportunities: openOpps.map((o) => ({
      id: o.id,
      type: o.opportunity_type,
      status: o.status,
      next_action: o.next_action,
      discovered_at: o.discovered_at,
    })),
  };

  const aiGateway = createAIGateway({ app, rdb, timeoutMs: 30000, maxAttempts: 1 });
  const task = await aiGateway.runAITask({
    taskType: 'person_summary',
    skill: 'person_summary',
    capability: 'summarization',
    subjectType: 'person',
    subjectId: id,
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
