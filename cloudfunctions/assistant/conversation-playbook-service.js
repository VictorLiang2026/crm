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

  const p360 = await app.callFunction({
    name: 'person_360',
    data: { action: 'getMeetingPrepContext', personId },
  });
  const prep = p360 && p360.result;
  if (!prep || typeof prep !== 'object') {
    const e = new Error('Person context unavailable');
    e.code = 'UPSTREAM_UNAVAILABLE';
    throw e;
  }

  // Build conversation_playbook context from meeting prep context + extras.
  const evidence = [];
  const recent = prep.recent_interactions?.content || [];
  recent.slice(0, 6).forEach((it) => {
    evidence.push(`互动: ${it.summary || it.interaction_type || ''}`.slice(0, 200));
  });
  const facts = prep.facts?.content || [];
  facts.slice(0, 6).forEach((f) => {
    evidence.push(`事实: ${f.content || f.fact || ''}`.slice(0, 200));
  });

  const context = {
    guidance: '保险销售对话原则：先理解客户真实顾虑，用事实和数据回应，不夸大承诺，不施压；尊重客户节奏，提供选择而非结论。',
    person: prep.person,
    recent_interactions: prep.recent_interactions,
    facts: prep.facts,
    signals: prep.signals,
    open_opportunities: prep.open_opportunities,
    relevant_playbooks: [],
    reliable_evidence: evidence,
  };

  const database = createSearchData({ env: process.env.TCB_ENV,
    key: process.env.CRM_ASSISTANT_DB_API_KEY });
  const aiGateway = createAIGateway({ app, rdb: database.auditRdb, timeoutMs: 30000, maxAttempts: 1 });
  const task = await aiGateway.runAITask({
    taskType: 'conversation_playbook',
    skill: 'conversation_playbook',
    capability: 'coaching',
    input: { person_id: personId, objection },
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
    evidenceRefs: task.result.evidenceRefs,
    nextObjective: task.result.nextObjective,
    doNotSay: task.result.doNotSay,
    taskId: task.taskId,
    resultId: task.resultId,
    skillVersion: task.skillVersion,
    execution: { modelCalled: true, businessDataRead: true, businessDataWritten: false },
  };
}

module.exports = { runConversationPlaybook };
