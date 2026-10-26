'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSkillRegistry, defaultRegistry, SkillValidationError, TIMEOUT_CLASS_MS } =
  require('../../cloudfunctions/_shared/skill-registry');
const { defaultRegistry: assistantRegistry } = require('../../cloudfunctions/assistant/skill-registry');

const names = ['quick_capture', 'person_summary', 'meeting_prep', 'today_coach',
  'opportunity_analysis', 'opportunity_candidate', 'activity_prepare', 'activity_review', 'recruit_coach',
  'conversation_playbook', 'knowledge_extract', 'dual_followup', 'ai_search', 'crm_search_parse'];
names.push('assistant_read_intent_v1', 'assistant_action_update_v1', 'assistant_opportunity_update_v1', 'crm_search_query_v2');

test('all versioned contracts are model-independent and immutable', () => {
  assert.deepEqual(defaultRegistry.list().map(item => item.name), names);
  for (const skill of defaultRegistry.list()) {
    assert.deepEqual(Object.keys(skill).sort(), ['name', 'version', 'capability', 'contextRecipe',
      'inputSchema', 'outputSchema', 'confirmationLevel', 'timeoutClass'].sort());
    assert.match(skill.version, /^\d+\.\d+\.\d+$/);
    assert.ok(TIMEOUT_CLASS_MS[skill.timeoutClass] > 0);
    assert.equal(Object.isFrozen(skill), true);
    assert.equal(Object.isFrozen(skill.inputSchema), true);
    assert.equal(JSON.stringify(skill).includes('model'), false);
    assert.equal(JSON.stringify(skill).includes('provider'), false);
  }
});

test('deployed assistant registry carries the same Recruit Coach v2 contract', () => {
  const shared=defaultRegistry.get('recruit_coach');
  const assistant=assistantRegistry.get('recruit_coach');
  assert.equal(shared.version,'2.0.0');
  assert.equal(assistant.version,shared.version);
  assert.deepEqual(assistant.outputSchema,shared.outputSchema);
  assert.deepEqual(assistant.contextRecipe,shared.contextRecipe);
});

test('deployed assistant registry carries the same PC24 search v2 contract', () => {
  const shared=defaultRegistry.get('crm_search_query_v2');
  const assistant=assistantRegistry.get('crm_search_query_v2');
  assert.equal(shared.version,'2.0.0');
  assert.equal(assistant.version,shared.version);
  assert.deepEqual(assistant.outputSchema,shared.outputSchema);
  assert.deepEqual(assistant.contextRecipe,shared.contextRecipe);
});

test('deployed assistant registry carries the same PC26 Action command contract', () => {
  const shared=defaultRegistry.get('assistant_action_update_v1');
  const assistant=assistantRegistry.get('assistant_action_update_v1');
  assert.equal(shared.version,'1.0.0');
  assert.equal(assistant.version,shared.version);
  assert.deepEqual(assistant.outputSchema,shared.outputSchema);
  assert.deepEqual(assistant.contextRecipe,shared.contextRecipe);
});

test('deployed assistant registry carries the same PC27 Opportunity command contract', () => {
  const shared=defaultRegistry.get('assistant_opportunity_update_v1');
  const assistant=assistantRegistry.get('assistant_opportunity_update_v1');
  assert.equal(assistant.version,shared.version);
  assert.deepEqual(assistant.outputSchema,shared.outputSchema);
  assert.deepEqual(assistant.contextRecipe,shared.contextRecipe);
});

test('every initial skill accepts a representative input, context and output', () => {
  const examples = {
    quick_capture: [{ text: 'Call tomorrow' }, {},
      { people: [], events: [], facts: [], needs: [], nextActions: [] }],
    person_summary: [{ personId: '1' }, { person: {} },
      { summary: 'Known facts', signals: [], gaps: [], nextActions: [], evidence: [] }],
    meeting_prep: [{ person_id: 1 }, { person: {}, household: null, relationship: [],
      recent_interactions: [], facts: [], signals: [], open_opportunities: [],
      open_actions: [], commitments: [], insurance_context: {}, relevant_playbook: {} },
    { brief30Seconds: 'A short person brief', recentChanges: [],
      suggestedObjective: 'Understand the current need', openingAngles: [],
      possibleObjections: [], questionsToConfirm: [], avoid: [] }],
    today_coach: [{ day: '2026-09-25' }, { daily_snapshot: {} },
      { priorities: [], reviewNote: 'Review the day' }],
    opportunity_analysis: [{ opportunityId: '1' }, { opportunity: {} },
      { assessment: 'Needs review', risks: [], nextActions: [], evidence: [] }],
    opportunity_candidate: [{ personId: 1 }, { person: {}, evidence: [],
      existing_opportunities: [], guidance: {} }, { status: 'insufficient_evidence',
      opportunityType: 'relationship', reason: '', nextAction: '', confidence: 0,
      sourceRefs: [] }],
    activity_prepare: [{ activityId: '1' }, { activity: {} },
      { brief: 'Prepare activity', checklist: [], outreach: [], risks: [] }],
    activity_review: [{ activityId: '1' }, { activity: {}, participants: [], tasks: [],
      persons: [], activity_interactions: [], recent_interactions: [], current_actions: [],
      open_opportunities: [], relationships: [] },
      { summary: 'Review activity', whoMattered: [], whatChanged: [], relationshipsImproved: [],
        signalsAppeared: [], opportunitiesAppeared: [], followUpPeople: [], actionCandidates: [] }],
    recruit_coach: [{ candidateId: '1', personId: '2', language: 'zh-CN' }, { candidate: {} },
      { assessment: 'Review candidate', dimensions: [
        'industry_resources','learning_ability','resilience','communication',
        'entrepreneurial_motivation','cultural_fit',
      ].map(key => ({key,score:null,rationale:'Insufficient data',evidenceRefs:[]})),
      contactSuggestion:{assumptionReasons:[],clarifyingQuestions:[],prohibitedPhrasing:[],nextStep:'Review the missing evidence.'},
      uncertainty:'Some evidence is missing.',confidence:'low' }],
    conversation_playbook: [{ person_id: 1, objection: '担心保障范围' },
      { guidance: {}, person: {}, recent_interactions: [], facts: [], signals: [],
        open_opportunities: [], relevant_playbooks: [], reliable_evidence: [] },
      { possibleUnderlyingReasons: ['可能担心理赔条件'], clarifyingQuestions: ['哪些范围最担心？'],
        responseLogic: '先确认具体担忧，再核对条款。', evidenceRefs: [],
        nextObjective: '明确待核实的保障范围', doNotSay: [] }],
    knowledge_extract: [{ domain: 'product', title: '产品说明' }, { document: '条款与产品介绍' },
      { summary: '产品定位摘要', keyPoints: [], applicationNotes: [], boundaries: [] }],
    dual_followup: [{ personId: '1', question: '如何跟进？', market: '中国' },
      { customer_snapshot: {}, recruit_context: {}, question: {}, market: {}, strategy_sources: [],
        library_sources: [], strategy_guidance: {}, library_guidance: {}, guardrails: {} },
      { candidates: ['strategy_based', 'library_based'].map(candidateType => ({ candidateType,
        summary: '下一步建议', reasoning: '依据客户情况和资料来源', clarifyingQuestions: [],
        nextAction: '先确认需求', messageDraft: '方便进一步了解吗？', boundaryNotes: [],
        sourceRefs: [], matchStatus: 'no_matching_sources' })) }],
    ai_search: [{ query: 'Find a fact' }, { search_results: [] },
      { answer: 'A sourced answer', citations: [{ sourceType: 'record', sourceId: '1', excerpt: 'Fact' }], confidence: 'low' }],
    crm_search_parse: [{ query: '最近三个月参加过活动但没有继续跟进的人' },
      { guidance: { supportedTemplates: ['activity_no_followup'] } },
      { template: 'activity_no_followup', months: 3 }],
    crm_search_query_v2: [{query:'最近参加活动且有近期跟进的客户',language:'zh-CN'}, {guidance:{}},
      {status:'supported',interpretation:'筛选近期活动参与并有跟进的客户。',personMention:null,
        filters:{roles:['customer'],relationshipTypes:null,fact:null,attendanceMonths:3,
          followupState:'recent',followupMonths:3,opportunityStatuses:null,opportunityTypes:null,recruitStages:null}}],
    assistant_read_intent_v1: [{query:'帮我准备明天和李明的会面',language:'zh-CN'}, {guidance:{}},
      {status:'supported',intent:'prepare',interpretation:'准备指定人物的会面。',personMention:'李明',options:[]}],
    assistant_action_update_v1: [{text:'把张明的跟进回访改到周五',language:'zh-CN'}, {guidance:{}},
      {status:'supported',operation:'update',interpretation:'更新指定行动的截止时间。',
        personMention:'张明',actionMention:'跟进回访',changes:{action_type:null,title:null,description:null,
          due_at:'2026-10-23T17:00:00+08:00',priority:null}}],
    assistant_opportunity_update_v1: [{text:'把张明的保障方案下一步改成下周核对资料',language:'zh-CN'}, {guidance:{}},
      {status:'supported',operation:'edit',interpretation:'更新机会的下一步计划。',
        personMention:'张明',opportunityMention:'保障方案',changes:{type:null,progress:null,
          nextAction:'下周核对资料',nextActionDate:null,status:null}}],
  };
  for (const name of names) {
    const [input, context, output] = examples[name];
    assert.equal(defaultRegistry.validateInput(name, input), true, name);
    assert.equal(defaultRegistry.validateContext(name, context), true, name);
    assert.equal(defaultRegistry.validateOutput(name, output), true, name);
  }
});

test('quick capture validates input, context and structured output with JSON Schema', () => {
  assert.equal(defaultRegistry.validateInput('quick_capture', { text: 'Call tomorrow' }), true);
  assert.equal(defaultRegistry.validateContext('quick_capture', {}), true);
  assert.equal(defaultRegistry.validateOutput('quick_capture', {
    people: [], events: [], facts: ['Call tomorrow'], needs: [], nextActions: [],
  }), true);
  assert.throws(() => defaultRegistry.validateInput('quick_capture', { text: '' }),
    error => error.code === 'INVALID_SKILL_INPUT' && error.details[0].keyword === 'minLength');
  assert.throws(() => defaultRegistry.validateInput('quick_capture', { text: 'x', unexpected: true }),
    error => error.code === 'INVALID_SKILL_INPUT' && error.details[0].keyword === 'additionalProperties');
  assert.throws(() => defaultRegistry.validateOutput('quick_capture', {
    people: [], events: [], facts: [], needs: [], nextActions: 'not an array',
  }), error => error.code === 'INVALID_SKILL_OUTPUT' && error.details.some(item => item.path === '/nextActions'));
});

test('required context sections and date formats are enforced', () => {
  assert.throws(() => defaultRegistry.validateContext('person_summary', {}),
    error => error.code === 'INVALID_SKILL_CONTEXT');
  assert.equal(defaultRegistry.validateContext('person_summary', { person: { id: '1' } }), true);
  assert.throws(() => defaultRegistry.validateContext('person_summary', {
    person: { id: '1' }, recent_interactions: Array(21).fill({}),
  }), error => error.code === 'INVALID_SKILL_CONTEXT');
  assert.throws(() => defaultRegistry.validateContext('person_summary', { person: {}, forbidden: true }),
    error => error.code === 'INVALID_SKILL_CONTEXT');
  assert.throws(() => defaultRegistry.validateInput('today_coach', { day: '2026-02-31' }),
    error => error.code === 'INVALID_SKILL_INPUT' && error.details[0].keyword === 'format');
  assert.equal(defaultRegistry.validateInput('today_coach', { day: '2026-09-25' }), true);
});

test('AI search requires source citations and bounded confidence', () => {
  assert.throws(() => defaultRegistry.validateOutput('ai_search', {
    answer: 'No source', citations: [], confidence: 'high',
  }), error => error.code === 'INVALID_SKILL_OUTPUT');
  assert.equal(defaultRegistry.validateOutput('ai_search', {
    answer: 'Found in record', citations: [{ sourceType: 'public_record', sourceId: '42', excerpt: 'Recorded fact' }],
    confidence: 'medium',
  }), true);
  assert.throws(() => defaultRegistry.validateOutput('ai_search', {
    answer: 'Guess', citations: [{ sourceType: 'record', sourceId: '42', excerpt: 'fact' }], confidence: 'certain',
  }), error => error.code === 'INVALID_SKILL_OUTPUT');
});

test('CRM search parser cannot output SQL, person names or result lists', () => {
  assert.equal(defaultRegistry.validateOutput('crm_search_parse', {
    template: 'declining_priority', months: 3,
  }), true);
  assert.throws(() => defaultRegistry.validateOutput('crm_search_parse', {
    template: 'declining_priority', months: 3, sql: 'SELECT * FROM public.persons',
  }), error => error.code === 'INVALID_SKILL_OUTPUT');
  assert.throws(() => defaultRegistry.validateOutput('crm_search_parse', {
    template: 'declining_priority', months: 3, people: ['invented'],
  }), error => error.code === 'INVALID_SKILL_OUTPUT');
});

test('registry rejects duplicate, malformed and model-coupled definitions', () => {
  const original = defaultRegistry.get('quick_capture');
  assert.throws(() => createSkillRegistry([original, original]),
    error => error instanceof SkillValidationError && error.code === 'DUPLICATE_SKILL');
  assert.throws(() => createSkillRegistry([{ ...original, model: 'any' }]),
    error => error.code === 'INVALID_SKILL_DEFINITION');
  assert.throws(() => createSkillRegistry([{ ...original, inputSchema: { type: 'nonexistent' } }]),
    error => error.code === 'INVALID_SKILL_SCHEMA');
});
