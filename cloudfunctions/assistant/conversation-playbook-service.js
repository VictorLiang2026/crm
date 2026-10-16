/** Conversation playbook: build context from person_360, call conversation_playbook skill. */
'use strict';

const { app } = require('./db');
const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');

function positiveId(value) {
  return /^[1-9][0-9]*$/.test(String(value || ''));
}

async function runConversationPlaybook(event) {
  const personId = String(event?.personId || '').trim();
  const objection = String(event?.objection || '').trim();
  const scenario = String(event?.scenario || '').trim();
  if (!positiveId(personId)) {
    const e = new Error('personId must be a positive integer');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (!objection || objection.length > 1000) {
    const e = new Error('objection is required (max 1000 chars)');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (scenario.length > 256) { const e = new Error('scenario is too long'); e.code = 'INVALID_INPUT'; throw e; }

  const p360 = await app.callFunction({
    name: 'person_360',
    data: { action: 'getMeetingPrepContext', personId, objection, scenario },
  });
  const prep = p360 && p360.result;
  if (!prep || typeof prep !== 'object' || prep.error || !prep.person) {
    const e = new Error(prep?.error ? `Person context error: ${prep.error}` : 'Person context unavailable');
    e.code = 'UPSTREAM_UNAVAILABLE';
    throw e;
  }

  const governance = prep.relevant_playbook?.content || {};
  const evidence = Array.isArray(governance.reliable_evidence) ? governance.reliable_evidence.slice(0, 12) : [];

  const context = {
    guidance: { principle: '先理解客户真实顾虑，不夸大承诺、不施压；潜在原因作为待确认假设。只引用 reliable_evidence 中的证据 ID；互动、Person 事实、案例和故事均不得作为已核验证据。尊重客户节奏，提供选择而非结论。' },
    person: prep.person,
    recent_interactions: prep.recent_interactions,
    facts: prep.facts,
    signals: prep.signals,
    open_opportunities: prep.open_opportunities,
    relevant_playbooks: Array.isArray(governance.relevant_playbooks) ? governance.relevant_playbooks.slice(0, 3) : [],
    reliable_evidence: evidence,
  };

  const database = createSearchData({ env: process.env.TCB_ENV,
    key: process.env.CRM_ASSISTANT_DB_API_KEY });
  const aiGateway = createAIGateway({ app, rdb: database.auditRdb, timeoutMs: 60000, maxAttempts: 1 });
  const task = await aiGateway.runAITask({
    taskType: 'conversation_playbook',
    skill: 'conversation_playbook',
    capability: 'coaching',
    subjectType: 'person',
    subjectId: personId,
    input: { person_id: personId, objection, ...(scenario ? { scenario } : {}) },
    context,
    contextSnapshot: {
      ...context,
      _context: { recipe: 'conversation_playbook', version: '2.0.0' },
    },
  });

  return {
    ok: true,
    personId,
    objection,
    possibleUnderlyingReasons: task.result.possibleUnderlyingReasons,
    clarifyingQuestions: task.result.clarifyingQuestions,
    responseLogic: task.result.responseLogic,
    evidenceRefs: [...new Set((Array.isArray(task.result.evidenceRefs) ? task.result.evidenceRefs : []).map(String))]
      .filter(id => evidence.some(row => String(row.id ?? row.reference?.id) === id)).map(Number),
    nextObjective: task.result.nextObjective,
    doNotSay: task.result.doNotSay,
    taskId: task.taskId,
    resultId: task.resultId,
    skillVersion: task.skillVersion,
    execution: { modelCalled: true, businessDataRead: true, businessDataWritten: false },
  };
}

module.exports = { runConversationPlaybook };
