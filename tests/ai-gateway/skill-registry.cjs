'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSkillRegistry, defaultRegistry, SkillValidationError, TIMEOUT_CLASS_MS } =
  require('../../cloudfunctions/_shared/skill-registry');

const names = ['quick_capture', 'person_summary', 'meeting_prep', 'today_coach',
  'opportunity_analysis', 'activity_prepare', 'activity_review', 'recruit_coach',
  'conversation_playbook', 'ai_search'];

test('all ten versioned contracts are model-independent and immutable', () => {
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

test('every initial skill accepts a representative input, context and output', () => {
  const examples = {
    quick_capture: [{ text: 'Call tomorrow' }, {},
      { people: [], events: [], facts: [], needs: [], nextActions: [] }],
    person_summary: [{ personId: '1' }, { person: {} },
      { summary: 'Known facts', signals: [], gaps: [], nextActions: [], evidence: [] }],
    meeting_prep: [{ personId: '1', goal: 'Prepare agenda' }, { person: {} },
      { brief: 'Meeting brief', agenda: [], questions: [], risks: [], evidence: [] }],
    today_coach: [{ day: '2026-09-25' }, { daily_snapshot: {} },
      { priorities: [], reviewNote: 'Review the day' }],
    opportunity_analysis: [{ opportunityId: '1' }, { opportunity: {} },
      { assessment: 'Needs review', risks: [], nextActions: [], evidence: [] }],
    activity_prepare: [{ activityId: '1' }, { activity: {} },
      { brief: 'Prepare activity', checklist: [], outreach: [], risks: [] }],
    activity_review: [{ activityId: '1' }, { activity: {} },
      { summary: 'Review activity', outcomes: [], followups: [], evidence: [] }],
    recruit_coach: [{ candidateId: '1' }, { candidate: {} },
      { assessment: 'Review candidate', conversationTips: [], nextActions: [], evidence: [] }],
    conversation_playbook: [{ personId: '1', scenario: 'First conversation' }, { person: {} },
      { opening: 'Hello', questions: [], objections: [], closing: 'Thank you', safetyNotes: [] }],
    ai_search: [{ query: 'Find a fact' }, { search_results: [] },
      { answer: 'A sourced answer', citations: [{ sourceType: 'record', sourceId: '1', excerpt: 'Fact' }], confidence: 'low' }],
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

test('registry rejects duplicate, malformed and model-coupled definitions', () => {
  const original = defaultRegistry.get('quick_capture');
  assert.throws(() => createSkillRegistry([original, original]),
    error => error instanceof SkillValidationError && error.code === 'DUPLICATE_SKILL');
  assert.throws(() => createSkillRegistry([{ ...original, model: 'any' }]),
    error => error.code === 'INVALID_SKILL_DEFINITION');
  assert.throws(() => createSkillRegistry([{ ...original, inputSchema: { type: 'nonexistent' } }]),
    error => error.code === 'INVALID_SKILL_SCHEMA');
});
