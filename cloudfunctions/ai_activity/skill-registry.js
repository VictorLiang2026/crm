/** Versioned, model-independent contracts for future AI-native work. */
'use strict';

const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');

const TIMEOUT_CLASS_MS = Object.freeze({ short: 30000, standard: 60000, long: 120000 });
const text = (maxLength = 4000) => ({ type: 'string', minLength: 1, maxLength });
const strings = (maxItems = 12, maxLength = 500) => ({ type: 'array', items: text(maxLength), maxItems });
const sectionNames = { type: 'array', maxItems: 30, uniqueItems: true,
  items: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' } };
const object = (properties, required = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const recipe = (required, optional = [], limits = {}) => ({ required, optional, limits });

const SKILLS = [
  {
    name: 'quick_capture', version: '1.0.0', capability: 'structured_extraction',
    contextRecipe: recipe([], ['operator_profile']),
    inputSchema: object({ text: text(12000) }, ['text']),
    outputSchema: object({ people: strings(12, 120), events: strings(20, 500),
      facts: strings(30, 500), needs: strings(20, 500), nextActions: strings(20, 500) },
    ['people', 'events', 'facts', 'needs', 'nextActions']),
    confirmationLevel: 'confirm_before_write', timeoutClass: 'standard',
  },
  {
    name: 'person_summary', version: '1.0.0', capability: 'summarization',
    contextRecipe: recipe(['person'], ['recent_interactions', 'open_opportunities'], { recent_interactions: 20, open_opportunities: 10 }),
    inputSchema: object({ personId: text(80), focus: text(300) }, ['personId']),
    outputSchema: object({ summary: text(3000), signals: strings(12, 400),
      gaps: strings(12, 400), nextActions: strings(10, 400), evidence: strings(20, 500) },
    ['summary', 'signals', 'gaps', 'nextActions', 'evidence']),
    confirmationLevel: 'review', timeoutClass: 'standard',
  },
  {
    name: 'meeting_prep', version: '2.0.0', capability: 'planning',
    contextRecipe: recipe(['person', 'household', 'relationship', 'recent_interactions',
      'facts', 'signals', 'open_opportunities', 'open_actions', 'commitments',
      'insurance_context', 'relevant_playbook'], [], {
      relationship: 10, recent_interactions: 6, facts: 10, signals: 10,
      open_opportunities: 10, open_actions: 10, commitments: 10,
    }),
    inputSchema: object({ person_id: { anyOf: [
      { type: 'integer', minimum: 1 }, { type: 'string', pattern: '^[1-9][0-9]*$', maxLength: 16 },
    ] } }, ['person_id']),
    outputSchema: object({ brief30Seconds: text(600), recentChanges: strings(6, 400),
      suggestedObjective: text(800), openingAngles: strings(6, 400),
      possibleObjections: strings(6, 400), questionsToConfirm: strings(8, 400),
      avoid: strings(6, 400) },
    ['brief30Seconds', 'recentChanges', 'suggestedObjective', 'openingAngles',
      'possibleObjections', 'questionsToConfirm', 'avoid']),
    confirmationLevel: 'review', timeoutClass: 'standard',
  },
  {
    name: 'today_coach', version: '1.0.0', capability: 'planning',
    contextRecipe: recipe(['daily_snapshot'], ['current_actions', 'recent_interactions', 'open_opportunities'],
      { current_actions: 50, recent_interactions: 50, open_opportunities: 30 }),
    inputSchema: object({ day: { type: 'string', format: 'date' }, focus: text(300) }, ['day']),
    outputSchema: object({ priorities: { type: 'array', maxItems: 10, items: object({
      action: text(400), reason: text(800), subjectId: text(80), evidence: strings(5, 400),
    }, ['action', 'reason', 'evidence']) }, reviewNote: text(2000) }, ['priorities', 'reviewNote']),
    confirmationLevel: 'review', timeoutClass: 'long',
  },
  {
    name: 'opportunity_analysis', version: '1.0.0', capability: 'analysis',
    contextRecipe: recipe(['opportunity'], ['person', 'recent_interactions', 'related_products'],
      { recent_interactions: 20, related_products: 20 }),
    inputSchema: object({ opportunityId: text(80), question: text(500) }, ['opportunityId']),
    outputSchema: object({ assessment: text(3000), risks: strings(12, 500),
      nextActions: strings(12, 500), evidence: strings(20, 500) },
    ['assessment', 'risks', 'nextActions', 'evidence']),
    confirmationLevel: 'confirm_before_write', timeoutClass: 'standard',
  },
  {
    name: 'activity_prepare', version: '1.0.0', capability: 'planning',
    contextRecipe: recipe(['activity'], ['participants', 'speakers', 'tasks'],
      { participants: 100, speakers: 30, tasks: 50 }),
    inputSchema: object({ activityId: text(80), objective: text(500) }, ['activityId']),
    outputSchema: object({ brief: text(3000), checklist: strings(30, 500),
      outreach: strings(20, 500), risks: strings(15, 500) },
    ['brief', 'checklist', 'outreach', 'risks']),
    confirmationLevel: 'confirm_before_write', timeoutClass: 'long',
  },
  {
    name: 'activity_review', version: '2.0.0', capability: 'analysis',
    contextRecipe: recipe(['activity', 'participants', 'tasks', 'persons', 'activity_interactions',
      'recent_interactions', 'current_actions', 'open_opportunities', 'relationships'], [],
    { participants: 20, tasks: 20, persons: 20, activity_interactions: 20,
      recent_interactions: 20, current_actions: 20, open_opportunities: 5, relationships: 20 }),
    inputSchema: object({ activityId: text(80), focus: text(500) }, ['activityId']),
    outputSchema: (() => {
      const refs = { type: 'array', maxItems: 5, uniqueItems: true,
        items: { type: 'string', pattern: '^public\\.[a-z_]+#[1-9][0-9]*$' } };
      const claim = object({ text: text(600), sourceRefs: refs }, ['text', 'sourceRefs']);
      const claims = { type: 'array', maxItems: 10, items: claim };
      const candidate = object({ personId: { anyOf: [
        { type: 'integer', minimum: 1 }, { type: 'string', pattern: '^[1-9][0-9]*$' },
      ] }, title: text(200), reason: text(600), sourceRefs: { ...refs, minItems: 1 } },
      ['personId', 'title', 'reason', 'sourceRefs']);
      return object({ summary: text(2000), whoMattered: claims, whatChanged: claims,
        relationshipsImproved: claims, signalsAppeared: claims,
        opportunitiesAppeared: claims, followUpPeople: claims,
        actionCandidates: { type: 'array', maxItems: 12, items: candidate } },
      ['summary', 'whoMattered', 'whatChanged', 'relationshipsImproved',
        'signalsAppeared', 'opportunitiesAppeared', 'followUpPeople', 'actionCandidates']);
    })(),
    confirmationLevel: 'confirm_before_write', timeoutClass: 'long',
  },
  {
    name: 'recruit_coach', version: '1.0.0', capability: 'coaching',
    contextRecipe: recipe(['candidate'], ['person', 'recruit_followups', 'recruit_goals'],
      { recruit_followups: 20, recruit_goals: 10 }),
    inputSchema: object({ candidateId: text(80), question: text(500) }, ['candidateId']),
    outputSchema: object({ assessment: text(3000), conversationTips: strings(15, 500),
      nextActions: strings(12, 500), evidence: strings(20, 500) },
    ['assessment', 'conversationTips', 'nextActions', 'evidence']),
    confirmationLevel: 'confirm_before_write', timeoutClass: 'standard',
  },
  {
    name: 'conversation_playbook', version: '1.0.0', capability: 'coaching',
    contextRecipe: recipe(['person'], ['recent_interactions', 'open_opportunities', 'goal'],
      { recent_interactions: 20, open_opportunities: 10 }),
    inputSchema: object({ personId: text(80), scenario: text(800) }, ['personId', 'scenario']),
    outputSchema: object({ opening: text(800), questions: strings(12, 500),
      objections: strings(12, 500), closing: text(800), safetyNotes: strings(10, 400) },
    ['opening', 'questions', 'objections', 'closing', 'safetyNotes']),
    confirmationLevel: 'confirm_before_write', timeoutClass: 'standard',
  },
  {
    name: 'ai_search', version: '1.0.0', capability: 'retrieval',
    contextRecipe: recipe(['search_results'], [], { search_results: 30 }),
    inputSchema: object({ query: text(1000), scope: strings(10, 80) }, ['query']),
    outputSchema: object({ answer: text(4000), citations: { type: 'array', minItems: 1, maxItems: 20,
      items: object({ sourceType: text(80), sourceId: text(120), excerpt: text(800) },
        ['sourceType', 'sourceId', 'excerpt']) },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] } },
    ['answer', 'citations', 'confidence']),
    confirmationLevel: 'review', timeoutClass: 'standard',
  },
];

const DEFINITION_SCHEMA = object({
  name: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
  version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
  capability: { type: 'string', minLength: 1 },
  contextRecipe: object({ required: sectionNames, optional: sectionNames,
    limits: { type: 'object', patternProperties: { '^[a-z][a-z0-9_]*$': { type: 'integer', minimum: 1, maximum: 1000 } },
      additionalProperties: false } }, ['required', 'optional', 'limits']),
  inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
  confirmationLevel: { type: 'string', enum: ['review', 'confirm_before_write'] },
  timeoutClass: { type: 'string', enum: Object.keys(TIMEOUT_CLASS_MS) },
}, ['name', 'version', 'capability', 'contextRecipe', 'inputSchema', 'outputSchema', 'confirmationLevel', 'timeoutClass']);

class SkillValidationError extends Error {
  constructor(code, skill, details) {
    super(`${code}: ${skill}`);
    this.name = 'SkillValidationError';
    this.code = code;
    this.skill = skill;
    this.details = details;
  }
}

function errorDetails(errors) {
  return (errors || []).map(error => ({ path: error.instancePath || '/', keyword: error.keyword, message: error.message }));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function createSkillRegistry(definitions = SKILLS) {
  const ajv = new Ajv2020({ strict: true, allErrors: true,
    removeAdditional: false, useDefaults: false, coerceTypes: false });
  addFormats(ajv, ['date', 'date-time']);
  const validateDefinition = ajv.compile(DEFINITION_SCHEMA);
  const entries = new Map();
  for (const source of definitions) {
    const definition = JSON.parse(JSON.stringify(source));
    if (!validateDefinition(definition)) {
      throw new SkillValidationError('INVALID_SKILL_DEFINITION', definition.name || '?', errorDetails(validateDefinition.errors));
    }
    if (entries.has(definition.name)) throw new SkillValidationError('DUPLICATE_SKILL', definition.name, []);
    const sections = [...definition.contextRecipe.required, ...definition.contextRecipe.optional];
    if (new Set(sections).size !== sections.length ||
        Object.keys(definition.contextRecipe.limits).some(name => !sections.includes(name))) {
      throw new SkillValidationError('INVALID_CONTEXT_RECIPE', definition.name, []);
    }
    try {
      const contextSchema = object(Object.fromEntries(sections.map(name => [name,
        definition.contextRecipe.limits[name] ? { type: 'array', maxItems: definition.contextRecipe.limits[name] } : {},
      ])), definition.contextRecipe.required);
      const validators = {
        context: ajv.compile(contextSchema),
        input: ajv.compile(definition.inputSchema),
        output: ajv.compile(definition.outputSchema),
      };
      entries.set(definition.name, { definition: deepFreeze(definition), validators });
    } catch (error) {
      throw new SkillValidationError('INVALID_SKILL_SCHEMA', definition.name,
        [{ path: '/', keyword: 'schema', message: error.message }]);
    }
  }
  function get(name) { return entries.get(name)?.definition || null; }
  function validate(name, kind, value) {
    const entry = entries.get(name);
    if (!entry) throw new SkillValidationError('UNKNOWN_SKILL', String(name), []);
    if (!['context', 'input', 'output'].includes(kind)) throw new SkillValidationError('INVALID_VALIDATION_KIND', name, []);
    const validator = entry.validators[kind];
    if (!validator(value)) throw new SkillValidationError(`INVALID_SKILL_${kind.toUpperCase()}`, name, errorDetails(validator.errors));
    return true;
  }
  return Object.freeze({ get, list: () => [...entries.values()].map(entry => entry.definition),
    validateContext: (name, value) => validate(name, 'context', value),
    validateInput: (name, value) => validate(name, 'input', value),
    validateOutput: (name, value) => validate(name, 'output', value) });
}

const defaultRegistry = createSkillRegistry();
module.exports = { createSkillRegistry, defaultRegistry, SkillValidationError, TIMEOUT_CLASS_MS };
