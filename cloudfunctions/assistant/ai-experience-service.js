/** Authenticated PC29 AI decision, actual Outcome, and human-reviewed Learning workflow. */
'use strict';

const { createAiExperienceData, ID, UUID } = require('./ai-experience-data');
const own = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => allowed.includes(key));
const exact = (value, allowed) => own(value, allowed) && Object.keys(value).length === allowed.length;
function fail(code = 'INVALID_INPUT') { const error = new Error('AI Experience request is invalid'); error.code = code; throw error; }
function boundedId(value) {
  if (!ID.test(String(value ?? '')) || !Number.isSafeInteger(Number(value))) fail();
  return Number(value);
}
function iso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail();
  return new Date(value).toISOString();
}
function jsonSize(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
function validateDecision(event, actorUid) {
  if (!exact(event, ['action','operation','eventId','aiResultId','decision','reason','editDelta']) ||
      !UUID.test(String(event.eventId || '')) || !['pending','accepted','modified','rejected'].includes(event.decision)) fail();
  const reason = event.reason == null || event.reason === '' ? null : String(event.reason).trim();
  if (reason && reason.length > 2000) fail();
  let editDelta = null;
  if (event.decision === 'modified') {
    if (!event.editDelta || typeof event.editDelta !== 'object' || Array.isArray(event.editDelta) ||
        !Object.keys(event.editDelta).length || jsonSize(event.editDelta) > 12000) fail();
    editDelta = event.editDelta;
  } else if (event.editDelta != null) fail();
  if (event.decision === 'rejected' && !reason) fail();
  return { actorUid, eventId: event.eventId, aiResultId: boundedId(event.aiResultId),
    decision: event.decision, reason, editDelta };
}
function validateOutcome(event, actorUid) {
  if (!exact(event, ['action','operation','idempotencyKey','targetType','targetId','aiResultId','result','occurredAt','evidence']) ||
      !UUID.test(String(event.idempotencyKey || '')) ||
      !['action','opportunity','activity','recruit_followup'].includes(event.targetType) ||
      typeof event.result !== 'string' || !event.result.trim() || event.result.trim().length > 4000 ||
      typeof event.evidence !== 'string' || !event.evidence.trim() || event.evidence.trim().length > 8000) fail();
  return { actorUid, idempotencyKey: event.idempotencyKey, targetType: event.targetType,
    targetId: boundedId(event.targetId), aiResultId: event.aiResultId == null || event.aiResultId === '' ? null : boundedId(event.aiResultId),
    result: event.result.trim(), occurredAt: iso(event.occurredAt), evidence: event.evidence.trim() };
}
function validateLearning(event, actorUid) {
  if (!exact(event, ['action','operation','candidateKey','payload']) ||
      !UUID.test(String(event.candidateKey || '')) || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) fail();
  const p = event.payload;
  const allowed = ['sourceResultIds','primaryResultId','situation','recommendation','actualAction','learning','scope','confidence','counterexampleIds'];
  if (!own(p, allowed) || !['sourceResultIds','primaryResultId','situation','learning','scope'].every(key => Object.hasOwn(p,key)) ||
      !Array.isArray(p.sourceResultIds) || p.sourceResultIds.length < 1 || p.sourceResultIds.length > 100 ||
      p.sourceResultIds.some(value => !ID.test(String(value)) || !Number.isSafeInteger(Number(value))) ||
      new Set(p.sourceResultIds.map(String)).size !== p.sourceResultIds.length ||
      !ID.test(String(p.primaryResultId)) || !p.sourceResultIds.map(String).includes(String(p.primaryResultId)) ||
      typeof p.situation !== 'string' || !p.situation.trim() || p.situation.trim().length > 2000 ||
      typeof p.learning !== 'string' || !p.learning.trim() || p.learning.trim().length > 4000 ||
      typeof p.scope !== 'string' || !p.scope.trim() || p.scope.trim().length > 128 ||
      (p.recommendation != null && (typeof p.recommendation !== 'string' || p.recommendation.length > 4000)) ||
      (p.actualAction != null && (typeof p.actualAction !== 'string' || p.actualAction.length > 4000)) ||
      (p.confidence != null && (typeof p.confidence !== 'number' || !Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1)) ||
      (p.counterexampleIds != null && (!Array.isArray(p.counterexampleIds) || p.counterexampleIds.length > 100 ||
        p.counterexampleIds.some(value => !p.sourceResultIds.map(String).includes(String(value))))) || jsonSize(p) > 20000) fail();
  return { actorUid, candidateKey: event.candidateKey, payload: {
    sourceResultIds: p.sourceResultIds.map(Number), primaryResultId: Number(p.primaryResultId),
    situation: p.situation.trim(), ...(p.recommendation == null ? {} : { recommendation: p.recommendation.trim() }),
    ...(p.actualAction == null ? {} : { actualAction: p.actualAction.trim() }), learning: p.learning.trim(), scope: p.scope.trim(),
    ...(p.confidence == null ? {} : { confidence: p.confidence }),
    ...(p.counterexampleIds == null || p.counterexampleIds.length === 0 ? {} : { counterexampleIds: p.counterexampleIds.map(Number) }),
  } };
}
function validateConfirmation(event, actorUid) {
  if (!exact(event, ['action','operation','learningId','decision']) || typeof event.decision !== 'string' ||
      !event.decision.trim() || event.decision.trim().length > 4000) fail();
  return { actorUid, learningId: boundedId(event.learningId), decision: event.decision.trim() };
}

async function runAiExperience(event, actorUid, deps = {}) {
  if (typeof actorUid !== 'string' || !actorUid.trim() || !event || event.action !== 'aiExperience' ||
      typeof event.operation !== 'string') fail();
  const data = deps.data || createAiExperienceData({ env: process.env.TCB_ENV, key: process.env.CRM_ASSISTANT_DB_API_KEY });
  if (event.operation === 'list' && exact(event, ['action','operation'])) return { ok:true, ...(await data.list()) };
  if (event.operation === 'list' && exact(event, ['action','operation','filters']))
    return { ok:true, ...(await data.history(require('./ai-history-query').validateHistory(event.filters))) };
  if (event.operation === 'targets' && exact(event, ['action','operation'])) return { ok:true, ...(await data.targets()) };
  if (event.operation === 'decide') return { ok:true, ...(await data.decide(validateDecision(event, actorUid))) };
  if (event.operation === 'outcome') return { ok:true, ...(await data.outcome(validateOutcome(event, actorUid))) };
  if (event.operation === 'learning') return { ok:true, ...(await data.learning(validateLearning(event, actorUid))) };
  if (event.operation === 'confirmLearning') return { ok:true, ...(await data.confirmLearning(validateConfirmation(event, actorUid))) };
  fail();
}

module.exports = { runAiExperience, validateDecision, validateOutcome, validateLearning, validateConfirmation };
