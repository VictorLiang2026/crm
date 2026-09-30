'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationPlaybookContextBuilder, runConversationPlaybook, forReview } =
  require('../../cloudfunctions/_shared/conversation-playbook');

const result = { possibleUnderlyingReasons: ['可能担心理赔不确定性'],
  clarifyingQuestions: ['您最想确认哪项保障责任？'],
  responseLogic: '先确认关切，再核对证据和适用条件。',
  evidenceRefs: [11, 12, 13, 14, 15, 99], nextObjective: '确认具体条款',
  doNotSay: ['保证一定赔付'] };

function fixture() {
  const calls = [];
  const rows = {
    persons: [{ id: 1, display_name: '测试客户', occupation: '教师', organization: '学校' }],
    interactions: Array.from({ length: 8 }, (_, index) => ({ id: index + 1,
      interaction_type: 'conversation', interaction_at: '2026-09-25T00:00:00Z',
      summary: '讨论保障范围', importance: 3 })),
    context_items: [{ id: 1, item_type: 'fact', content: '关心医疗保障', confirmed: true },
      { id: 2, item_type: 'fact', content: '模型猜测的事实', confirmed: false },
      { id: 3, item_type: 'signal', content: '对理赔有疑虑', confirmed: false }],
    opportunities: [{ id: 1, opportunity_type: 'insurance', status: '沟通', last_progress: '范围待核对' }],
    playbooks: [{ id: 1, scenario: '保障咨询', objection: '担心保障范围',
      possible_underlying_reasons: ['担心理赔'], clarifying_questions: ['具体哪项？'],
      response_logic: '核对条款', evidence_refs: [11, 12, 13, 14, 15],
      do_not_say: ['绝对能赔'], next_objective: '确认条款' }],
    knowledge_items: [
      { id: 11, item_type: 'evidence', source: '已核验条款', source_date: '2026-08-01',
        verified: true, confidence: '0.900', content: '保障范围以条款为准' },
      { id: 12, item_type: 'evidence', source: '未核验', verified: false,
        confidence: '0.900', content: '未经核验' },
      { id: 13, item_type: 'evidence', source: '过期条款', verified: true,
        confidence: '0.900', valid_to: '2026-08-01', content: '已过期' },
      { id: 14, item_type: 'story', source: '故事', verified: true,
        confidence: '0.900', content: '不是证据' },
      { id: 15, item_type: 'evidence', source: '低可信度', verified: true,
        confidence: '0.400', content: '仍需确认' },
    ],
  };
  const request = async (table, method, filters) => {
    calls.push({ table, method, filters });
    return (rows[table] || []).slice(0, filters.limit);
  };
  return { calls, rows, request };
}

test('builds bounded Person context and admits only verified, current evidence', async () => {
  const { calls, request } = fixture();
  const built = await new ConversationPlaybookContextBuilder({ request,
    now: () => new Date('2026-09-30T00:00:00Z') }).build({ person_id: 1,
    objection: '担心保障范围', scenario: '保障咨询' });
  assert.equal(built.context.person.source.schema, 'public');
  assert.equal(built.context.recent_interactions.length, 6);
  assert.deepEqual(built.context.facts.map(row => row.content), ['关心医疗保障']);
  assert.deepEqual(built.context.signals.map(row => row.content), ['对理赔有疑虑']);
  assert.equal(built.context.relevant_playbooks.length, 1);
  assert.deepEqual(built.context.reliable_evidence.map(row => row.id), [11]);
  assert.equal(built.context_snapshot._context.subject_id, '1');
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.deepEqual(calls.find(call => call.table === 'knowledge_items').filters.id, 'in.(11,12,13,14,15)');
});

test('a matching scenario cannot override a different expressed objection', async () => {
  const { request, rows } = fixture();
  rows.playbooks[0].objection = '担心服务时效';
  const built = await new ConversationPlaybookContextBuilder({ request,
    now: () => new Date('2026-09-30T00:00:00Z') }).build({ person_id: 1,
    objection: '担心保障范围', scenario: '保障咨询' });
  assert.deepEqual(built.context.relevant_playbooks, []);
  assert.deepEqual(built.context.reliable_evidence, []);
});

test('unsupported citations never become evidence and missing evidence requires confirmation', () => {
  const context = { reliable_evidence: [{ id: 11, source_name: '已核验条款' }] };
  const review = forReview(result, context);
  assert.deepEqual(review.evidence.map(row => row.id), [11]);
  assert.equal(review.needs_evidence_confirmation, false);
  assert.equal(review.possible_underlying_reasons[0].needs_confirmation, true);
  const missing = forReview({ ...result, evidenceRefs: [99] }, context);
  assert.equal(missing.needs_evidence_confirmation, true);
  assert.match(missing.evidence_notice, /必须人工确认/);
  assert.deepEqual(missing.evidence, []);
});

test('runs through Gateway with snapshot and never writes CRM business data', async () => {
  const { request } = fixture();
  let seen;
  const gateway = { runAITask: async request => { seen = request;
    return { taskId: 5, resultId: 7, result }; } };
  const output = await runConversationPlaybook({ input: { person_id: 1, objection: '担心保障范围' },
    request, gateway, now: () => new Date('2026-09-30T00:00:00Z') });
  assert.equal(seen.skill, 'conversation_playbook');
  assert.equal(seen.capability, 'coaching');
  assert.equal(seen.contextSnapshot._context.recipe, 'conversation_playbook');
  assert.equal(output.review.business_data_written, false);
  assert.equal(output.review.requires_human_review, true);
});

test('rejects empty objection and unknown Person before any model call', async () => {
  const { request, rows } = fixture();
  let calls = 0;
  const gateway = { runAITask: async () => { calls++; } };
  await assert.rejects(runConversationPlaybook({ input: { person_id: 1, objection: '' }, request, gateway }),
    error => error.code === 'INVALID_SKILL_INPUT');
  rows.persons = [];
  await assert.rejects(runConversationPlaybook({ input: { person_id: 1, objection: '价格高' }, request, gateway }),
    /Person not found/);
  assert.equal(calls, 0);
});
