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
    name: 'opportunity_candidate', version: '1.0.0', capability: 'analysis',
    contextRecipe: recipe(['person', 'evidence', 'existing_opportunities', 'guidance'], [],
      { evidence: 30, existing_opportunities: 10 }),
    inputSchema: object({ personId: { anyOf: [
      { type: 'integer', minimum: 1 }, { type: 'string', pattern: '^[1-9][0-9]*$' },
    ] } }, ['personId']),
    outputSchema: object({
      status: { type: 'string', enum: ['candidate', 'insufficient_evidence'] },
      opportunityType: { type: 'string', enum: [
        'insurance','recruit','referral','activity','speaker','partnership','service','relationship',
      ] },
      reason: { type: 'string', maxLength: 1000 },
      nextAction: { type: 'string', maxLength: 500 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      sourceRefs: { type: 'array', maxItems: 8, uniqueItems: true,
        items: { type: 'string', pattern: '^public\\.[a-z_]+#[1-9][0-9]*$' } },
    }, ['status','opportunityType','reason','nextAction','confidence','sourceRefs']),
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
    name: 'activity_review', version: '2.1.0', capability: 'analysis',
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
      const opportunityCandidate = object({ personId: { anyOf: [
        { type: 'integer', minimum: 1 }, { type: 'string', pattern: '^[1-9][0-9]*$' },
      ] }, opportunityType: { type: 'string', enum: [
        'insurance','recruit','referral','activity','speaker','partnership','service','relationship',
      ] }, reason: text(600), nextAction: text(500), sourceRefs: { ...refs, minItems: 1 } },
      ['personId', 'opportunityType', 'reason', 'nextAction', 'sourceRefs']);
      return object({ summary: text(2000), whoMattered: claims, whatChanged: claims,
        relationshipsImproved: claims, signalsAppeared: claims,
        opportunitiesAppeared: claims, followUpPeople: claims,
        actionCandidates: { type: 'array', maxItems: 12, items: candidate },
        opportunityCandidates: { type: 'array', maxItems: 1, items: opportunityCandidate } },
      ['summary', 'whoMattered', 'whatChanged', 'relationshipsImproved',
        'signalsAppeared', 'opportunitiesAppeared', 'followUpPeople', 'actionCandidates']);
    })(),
    confirmationLevel: 'confirm_before_write', timeoutClass: 'long',
  },
  {
    name: 'recruit_coach', version: '2.0.0', capability: 'coaching',
    contextRecipe: recipe(['candidate'], ['person', 'recruit_followups', 'recruit_goals', 'guidance'],
      { recruit_followups: 20 }),
    inputSchema: object({ candidateId: text(80), personId: text(80), question: text(500),
      language: { type: 'string', enum: ['zh-CN','en'] } }, ['candidateId', 'personId']),
    outputSchema: (() => {
      const sourceRefs = { type: 'array', maxItems: 5, uniqueItems: true,
        items: { type: 'string', pattern: '^public\\.[a-z_]+#[1-9][0-9]*$' } };
      const score = { anyOf: [{ type: 'integer', minimum: 0, maximum: 100 }, { type: 'null' }] };
      const dimension = object({ key: { type: 'string', enum: [
        'industry_resources','learning_ability','resilience','communication','entrepreneurial_motivation','cultural_fit',
      ] }, score, rationale: text(500), evidenceRefs: sourceRefs },
      ['key','score','rationale','evidenceRefs']);
      return object({ assessment: text(2000), dimensions: { type: 'array', minItems: 6, maxItems: 6, items: dimension },
        contactSuggestion: object({ assumptionReasons: strings(8, 400), clarifyingQuestions: strings(8, 400),
          prohibitedPhrasing: strings(8, 300), nextStep: text(500) },
        ['assumptionReasons','clarifyingQuestions','prohibitedPhrasing','nextStep']),
        uncertainty: text(500), confidence: { type: 'string', enum: ['high','medium','low'] } },
      ['assessment','dimensions','contactSuggestion','uncertainty','confidence']);
    })(),
    confirmationLevel: 'confirm_before_write', timeoutClass: 'standard',
  },
  {
    name: 'conversation_playbook', version: '2.0.0', capability: 'coaching',
    contextRecipe: recipe(['guidance', 'person', 'recent_interactions', 'facts', 'signals',
      'open_opportunities', 'relevant_playbooks', 'reliable_evidence'], [],
    { recent_interactions: 6, facts: 8, signals: 8, open_opportunities: 5,
      relevant_playbooks: 3, reliable_evidence: 12 }),
    inputSchema: object({ person_id: { anyOf: [
      { type: 'integer', minimum: 1 }, { type: 'string', pattern: '^[1-9][0-9]*$', maxLength: 16 },
    ] }, objection: text(1000), scenario: text(256) }, ['person_id', 'objection']),
    outputSchema: object({ possibleUnderlyingReasons: { ...strings(6, 400), minItems: 1 },
      clarifyingQuestions: { ...strings(8, 400), minItems: 1 }, responseLogic: text(1600),
      evidenceRefs: { type: 'array', maxItems: 12, uniqueItems: true,
        items: { anyOf: [{ type: 'integer', minimum: 1 },
          { type: 'string', pattern: '^[1-9][0-9]*$', maxLength: 16 }] } },
      nextObjective: text(500), doNotSay: strings(6, 300) },
    ['possibleUnderlyingReasons', 'clarifyingQuestions', 'responseLogic',
      'evidenceRefs', 'nextObjective', 'doNotSay']),
    confirmationLevel: 'review', timeoutClass: 'standard',
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
  {
    name: 'crm_search_parse', version: '1.0.0', capability: 'structured_extraction',
    contextRecipe: recipe(['guidance']),
    inputSchema: object({ query: text(1000) }, ['query']),
    outputSchema: object({
      template: { type: 'string', enum: [
        'activity_no_followup', 'child_education_no_insurance',
        'declining_priority', 'unsupported',
      ] },
      months: { type: 'integer', minimum: 1, maximum: 12 },
    }, ['template', 'months']),
    confirmationLevel: 'review', timeoutClass: 'short',
  },
  {
    name: 'assistant_read_intent_v1', version: '1.0.0', capability: 'intent_classification',
    contextRecipe: recipe(['guidance']),
    inputSchema: object({query:text(1000),language:{type:'string',enum:['zh-CN','en']},
      selectedIntent:{type:['string','null'],enum:['search','summarize','prepare','analyze','plan','unsupported',null]}},
    ['query','language']),
    outputSchema: object({status:{type:'string',enum:['supported','needs_clarification','unsupported']},
      intent:{type:'string',enum:['search','summarize','prepare','analyze','plan','unsupported']},
      interpretation:text(300),personMention:{type:['string','null'],maxLength:120},
      options:{type:'array',uniqueItems:true,maxItems:4,items:{type:'string',enum:['search','summarize','prepare','analyze','plan']}}},
    ['status','intent','interpretation','personMention','options']),
    confirmationLevel:'review',timeoutClass:'short',
  },
  {
    name: 'assistant_action_update_v1', version: '1.0.0', capability: 'structured_extraction',
    contextRecipe: recipe(['guidance']),
    inputSchema: object({text:text(1200),language:{type:'string',enum:['zh-CN','en']}},['text','language']),
    outputSchema: object({
      status:{type:'string',enum:['supported','needs_clarification','unsupported']},
      operation:{type:'string',enum:['update','close','unsupported']},
      interpretation:text(300),personMention:{type:['string','null'],maxLength:120},
      actionMention:{type:['string','null'],maxLength:200},
      changes:object({action_type:{type:['string','null'],maxLength:64},title:{type:['string','null'],maxLength:200},
        description:{type:['string','null'],maxLength:4000},due_at:{type:['string','null'],maxLength:64},
        priority:{type:['string','null'],enum:['low','medium','high','urgent',null]}},
      ['action_type','title','description','due_at','priority'])
    },['status','operation','interpretation','personMention','actionMention','changes']),
    confirmationLevel:'confirm_before_write',timeoutClass:'short',
  },
  {
    name: 'crm_search_query_v2', version: '2.0.0', capability: 'structured_extraction',
    contextRecipe: recipe(['guidance']),
    inputSchema: object({ query: text(1000), language: { type: 'string', enum: ['zh-CN','en'] } }, ['query','language']),
    outputSchema: object({
      status: { type: 'string', enum: ['supported','unsupported'] },
      interpretation: text(500),
      personMention: { anyOf: [text(160), { type: 'null' }] },
      filters: object({
        roles: { anyOf: [{ type: 'array', items: { type: 'string', enum: ['customer','recruit','speaker','participant'] }, minItems: 1, maxItems: 4, uniqueItems: true }, { type: 'null' }] },
        relationshipTypes: { anyOf: [{ type: 'array', items: { type: 'string', enum: ['family','friend','colleague','business','referral','other'] }, minItems: 1, maxItems: 6, uniqueItems: true }, { type: 'null' }] },
        fact: { anyOf: [object({ category: { anyOf: [text(64), { type: 'null' }] }, contains: { anyOf: [text(80), { type: 'null' }] } }, ['category','contains']), { type: 'null' }] },
        attendanceMonths: { anyOf: [{ type: 'integer', minimum: 1, maximum: 24 }, { type: 'null' }] },
        followupState: { anyOf: [{ type: 'string', enum: ['recent','none'] }, { type: 'null' }] },
        followupMonths: { anyOf: [{ type: 'integer', minimum: 1, maximum: 24 }, { type: 'null' }] },
        opportunityStatuses: { anyOf: [{ type: 'array', items: { type: 'string', enum: ['发现','沟通','方案','潜在线索','已介绍','已联系','已建立关系','成交','关闭'] }, minItems: 1, maxItems: 6, uniqueItems: true }, { type: 'null' }] },
        opportunityTypes: { anyOf: [{ type: 'array', items: { type: 'string', enum: ['insurance','recruit','referral','activity','speaker','partnership','service','relationship','医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障','转介绍'] }, minItems: 1, maxItems: 6, uniqueItems: true }, { type: 'null' }] },
        recruitStages: { anyOf: [{ type: 'array', items: { type: 'string', enum: ['新增人才','互动暖客','初次面谈','增员活动','精准面谈','入职申请','签约入司','流失','名单','接触','面谈1','面谈2','创说会','报考','入司','转正'] }, minItems: 1, maxItems: 6, uniqueItems: true }, { type: 'null' }] },
      }, ['roles','relationshipTypes','fact','attendanceMonths','followupState','followupMonths','opportunityStatuses','opportunityTypes','recruitStages']),
    }, ['status','interpretation','personMention','filters']),
    confirmationLevel: 'review', timeoutClass: 'short',
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
