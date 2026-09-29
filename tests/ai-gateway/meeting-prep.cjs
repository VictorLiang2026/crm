'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MeetingPrepContextBuilder } = require('../../cloudfunctions/person_360/meeting-prep-context');
const { defaultRegistry } = require('../../cloudfunctions/_shared/skill-registry');

function fixture() {
  const calls = [];
  async function request(table, method, filters) {
    calls.push({ table, method, filters });
    assert.equal(method, 'GET');
    switch (table) {
      case 'persons':
        return filters.id === 'eq.1' ? [{ id: 1, display_name: '[CRM_TEST_ONLY]甲',
          occupation: '顾问', organization: '测试机构', legacy_customer_id: null }] :
          [{ id: 2, display_name: '[CRM_TEST_ONLY]乙' }];
      case 'households': return [{ id: 3, anchor_person_id: 1, important_facts: '有一名配偶' }];
      case 'household_members': return filters.household_id ?
        [{ id: 4, person_id: 2, relationship_to_anchor: 'spouse', confirmed_at: '2026-09-28' }] : [];
      case 'relationships': return filters.from_person_id ?
        [{ id: 5, to_person_id: 2, relationship_type: 'colleague', trust_level: 'high' }] : [];
      case 'context_items': return [
        { id: 6, item_type: 'fact', content: '人工确认的事实', confirmed: true },
        { id: 7, item_type: 'fact', content: '未确认的 AI 候选', confirmed: false },
        { id: 8, item_type: 'signal', content: '观察线索', confirmed: false },
      ];
      case 'opportunities': return [{ id: 9, opportunity_type: 'insurance', status: '沟通',
        next_action: '核对保单' }, { id: 10, opportunity_type: 'recruit', status: '关闭' }];
      case 'actions': return [{ id: 11, title: '准备资料', priority: 'high' }];
      case 'commitments': return [{ id: 12, commitment_type: 'I_PROMISED', content: '发送方案' }];
      default: throw new Error(`Unexpected source: ${table}`);
    }
  }
  const builder = new MeetingPrepContextBuilder({ request,
    listInteractions: async () => ({ rows: Array.from({ length: 8 }, (_, i) => ({
      id: i + 20, interaction_at: '2026-09-28T00:00:00Z', summary: `近期互动 ${i}`,
      raw_note: 'MUST_NOT_RETURN', virtual: false,
    })) }),
    insuranceContext: async () => ({ existingCoverage: [{ label: '医疗(CI)' }],
      openOpportunities: [], nextActions: [] }),
  });
  return { builder, calls };
}

test('meeting_prep 2.0 accepts only person_id and seven review-only output fields', () => {
  const skill = defaultRegistry.get('meeting_prep');
  assert.equal(skill.version, '2.0.0');
  assert.equal(skill.confirmationLevel, 'review');
  assert.equal(defaultRegistry.validateInput('meeting_prep', { person_id: 1 }), true);
  assert.throws(() => defaultRegistry.validateInput('meeting_prep', { person_id: 1, goal: 'legacy' }),
    error => error.code === 'INVALID_SKILL_INPUT');
  const result = { brief30Seconds: '30-second brief', recentChanges: [],
    suggestedObjective: 'Check the need', openingAngles: [], possibleObjections: [],
    questionsToConfirm: [], avoid: [] };
  assert.equal(defaultRegistry.validateOutput('meeting_prep', result), true);
  assert.throws(() => defaultRegistry.validateOutput('meeting_prep', { ...result, avoid: undefined }),
    error => error.code === 'INVALID_SKILL_OUTPUT');
});

test('builder reads bounded sourced Person context and does not promote AI fact candidate', async () => {
  const { builder, calls } = fixture();
  const context = await builder.build(1);
  assert.equal(defaultRegistry.validateContext('meeting_prep', context), true);
  assert.equal(context.person.data.display_name, '[CRM_TEST_ONLY]甲');
  assert.equal(context.household.members.length, 1);
  assert.equal(context.relationship[0].other_name, '[CRM_TEST_ONLY]乙');
  assert.equal(context.recent_interactions.length, 6);
  assert.deepEqual(context.facts.map(row => row.content), ['人工确认的事实']);
  assert.deepEqual(context.signals.map(row => row.content), ['观察线索']);
  assert.equal(context.open_opportunities.length, 1);
  assert.equal(context.open_actions.length, 1);
  assert.equal(context.commitments.length, 1);
  assert.equal(context.insurance_context.existingCoverage.length, 1);
  assert.equal(context.relevant_playbook.status, 'unavailable');
  assert.ok(!JSON.stringify(context).includes('MUST_NOT_RETURN'));
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(calls.every(call => !/raw_note|phone|photo_url/.test(call.filters.select || '')));
  assert.ok(calls.every(call => call.filters.limit <= 30));
});

test('missing Person fails before reading any dependent table', async () => {
  const calls = [];
  const builder = new MeetingPrepContextBuilder({ request: async (table, method) => {
    calls.push({ table, method }); return [];
  } });
  await assert.rejects(builder.build(1), /Person not found/);
  assert.deepEqual(calls, [{ table: 'persons', method: 'GET' }]);
});
