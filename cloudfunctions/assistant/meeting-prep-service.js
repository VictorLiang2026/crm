/** Meeting prep: fetch context from person_360, call meeting_prep skill via AI Gateway. */
'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const { app } = require('./db');
const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');

function positiveId(value) {
  return /^[1-9][0-9]*$/.test(String(value || ''));
}

async function runMeetingPrep(event) {
  const personId = String(event?.personId || '').trim();
  if (!positiveId(personId)) {
    const e = new Error('personId must be a positive integer');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  const p360 = await app.callFunction({
    name: 'person_360',
    data: { action: 'getMeetingPrepContext', personId },
  });
  const context = p360 && p360.result;
  if (!context || typeof context !== 'object') {
    const e = new Error('Meeting prep context unavailable');
    e.code = 'UPSTREAM_UNAVAILABLE';
    throw e;
  }

  const database = createSearchData({ env: process.env.TCB_ENV,
    key: process.env.CRM_ASSISTANT_DB_API_KEY });
  const aiGateway = createAIGateway({ app, rdb: database.auditRdb, timeoutMs: 30000, maxAttempts: 1 });
  const task = await aiGateway.runAITask({
    taskType: 'meeting_prep',
    skill: 'meeting_prep',
    capability: 'planning',
    input: { person_id: personId },
    context,
    contextSnapshot: {
      ...context,
      _context: { recipe: 'meeting_prep', version: '2.0.0', source: 'person_360.getMeetingPrepContext' },
    },
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
    taskId: task.taskId,
    resultId: task.resultId,
    skillVersion: task.skillVersion,
    execution: { modelCalled: true, businessDataRead: true, businessDataWritten: false },
  };
}

module.exports = { runMeetingPrep };
