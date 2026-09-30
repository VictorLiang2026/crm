/** Explicit, side-effect-free intent routing for the future CRM assistant. */
'use strict';

const CANDIDATE_TYPES = new Set([
  'person', 'interaction', 'fact', 'signal', 'inference',
  'opportunity', 'action', 'commitment',
]);
const ROUTES = Object.freeze({
  search: Object.freeze({ none: ['ai_search', 'search_results', 'retrieval', 'review'] }),
  summarize: Object.freeze({ person: ['person_summary', 'person_basic', 'summarization', 'review'] }),
  prepare: Object.freeze({
    person: ['meeting_prep', 'meeting_prep', 'planning', 'review'],
    activity: ['activity_prepare', 'activity_prepare', 'planning', 'confirm_before_write'],
  }),
  analyze: Object.freeze({
    opportunity: ['opportunity_analysis', 'opportunity', 'analysis', 'confirm_before_write'],
    activity: ['activity_review', 'activity_review', 'analysis', 'confirm_before_write'],
  }),
  plan: Object.freeze({ day: ['today_coach', 'today_coach', 'planning', 'review'] }),
  create_candidate: Object.freeze({
    none: [null, null, 'candidate', 'confirm_before_write'],
    person: [null, null, 'candidate', 'confirm_before_write'],
    activity: [null, null, 'candidate', 'confirm_before_write'],
    opportunity: [null, null, 'candidate', 'confirm_before_write'],
  }),
  update_candidate: Object.freeze({
    none: [null, null, 'candidate', 'confirm_before_write'],
    person: [null, null, 'candidate', 'confirm_before_write'],
    activity: [null, null, 'candidate', 'confirm_before_write'],
    opportunity: [null, null, 'candidate', 'confirm_before_write'],
  }),
});

class IntentError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function exactKeys(value, allowed, label) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new IntentError('INVALID_INPUT', `Invalid ${label}`);
  }
}

function text(value, max, required = false) {
  if (value == null && !required) return;
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > max) {
    throw new IntentError('INVALID_INPUT', 'Invalid text input');
  }
}

function positiveId(value) {
  return (typeof value === 'string' || typeof value === 'number') &&
    /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
}

function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeJsonObject(value) {
  if (!record(value) || Object.keys(value).length === 0) return false;
  const seen = new Set();
  function inspect(item, depth) {
    if (depth > 8) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))) return true;
    if (typeof item !== 'object' || seen.has(item)) return false;
    seen.add(item);
    if (Array.isArray(item)) return item.length <= 30 && item.every(child => inspect(child, depth + 1));
    if (!record(item) || Object.keys(item).length > 40 ||
      Object.keys(item).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) return false;
    return Object.values(item).every(child => inspect(child, depth + 1));
  }
  return inspect(value, 0) && JSON.stringify(value).length <= 8000;
}

function subjectOf(intent, raw) {
  if (raw === undefined && ['search', 'create_candidate', 'update_candidate'].includes(intent)) {
    return { type: 'none', id: null };
  }
  exactKeys(raw, ['type', 'id'], 'subject');
  const type = raw.type;
  if (typeof type !== 'string' || !ROUTES[intent][type]) {
    throw new IntentError('INVALID_SUBJECT', 'Unsupported subject for intent');
  }
  if (type === 'none') {
    if (raw.id !== undefined && raw.id !== null) throw new IntentError('INVALID_SUBJECT', 'Subject id must be empty');
    return { type, id: null };
  }
  if (type === 'day') {
    if (!day(raw.id)) throw new IntentError('INVALID_SUBJECT', 'Invalid day');
  } else if (!positiveId(raw.id)) throw new IntentError('INVALID_SUBJECT', 'Invalid subject id');
  return { type, id: String(raw.id) };
}

function inputOf(intent, raw) {
  exactKeys(raw, {
    search: ['query', 'scope'], summarize: ['focus'], prepare: ['objective'],
    analyze: ['question'], plan: ['focus'],
    create_candidate: ['candidateType', 'draft'],
    update_candidate: ['candidateType', 'candidateId', 'changes'],
  }[intent], 'input');
  if (intent === 'search') {
    text(raw.query, 1000, true);
    if (raw.scope !== undefined && (!Array.isArray(raw.scope) || raw.scope.length > 5 ||
      raw.scope.some(item => !['person', 'activity', 'opportunity', 'knowledge'].includes(item)))) {
      throw new IntentError('INVALID_INPUT', 'Invalid search scope');
    }
  } else if (intent === 'summarize' || intent === 'plan') text(raw.focus, 300);
  else if (intent === 'prepare') text(raw.objective, 500);
  else if (intent === 'analyze') text(raw.question, 500);
  else {
    if (!CANDIDATE_TYPES.has(raw.candidateType)) throw new IntentError('INVALID_INPUT', 'Invalid candidate type');
    if (intent === 'update_candidate' &&
      (typeof raw.candidateId !== 'string' || raw.candidateId.length > 120 ||
        !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(raw.candidateId))) {
      throw new IntentError('INVALID_INPUT', 'Invalid candidate reference');
    }
    if (!safeJsonObject(intent === 'create_candidate' ? raw.draft : raw.changes)) {
      throw new IntentError('INVALID_INPUT', 'Invalid candidate payload');
    }
  }
  return raw;
}

function routeIntent(event) {
  exactKeys(event, ['intent', 'subject', 'input'], 'request');
  const intent = event.intent;
  if (typeof intent !== 'string' || !Object.hasOwn(ROUTES, intent)) {
    throw new IntentError('INVALID_INTENT', 'Unsupported intent');
  }
  const subject = subjectOf(intent, event.subject);
  const input = inputOf(intent, event.input);
  const [skill, contextRecipe, capability, confirmationLevel] = ROUTES[intent][subject.type];
  return {
    ok: true,
    status: 'routed',
    intent,
    route: { key: `${intent}.${subject.type}`, skill, contextRecipe, capability,
      subject, candidateType: input.candidateType || null, confirmationLevel },
    execution: { performed: false, modelCalled: false, businessDataRead: false,
      businessDataWritten: false },
  };
}

module.exports = { routeIntent, IntentError, ROUTES };
