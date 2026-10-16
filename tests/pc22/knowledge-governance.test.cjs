'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { KnowledgeGovernanceService } = require('../../cloudfunctions/person_360/knowledge-governance-service');
const { MeetingPrepContextBuilder } = require('../../cloudfunctions/person_360/meeting-prep-context');

test('governance saves drafts server-side and review uses authenticated actor plus optimistic version', async () => {
  const calls = [];
  const service = new KnowledgeGovernanceService({
    request: async (...args) => { calls.push(args); return [{ id: 1, updated_at: '2026-10-16T10:00:00Z', lifecycle_status: 'draft' }]; },
    rpc: async (...args) => { calls.push(args); return { ok: true }; },
  });
  const row = await service.save({ item_type: 'evidence', source: 'policy page', content: 'Clause', confidence: '0.9' }, 'operator-1');
  assert.equal(row.lifecycle_status, 'draft');
  assert.equal(calls[0][0], 'knowledge_items');
  assert.equal(calls[0][1], 'POST');
  assert.equal(calls[0][3].verified, false);
  assert.deepEqual(await service.review({ table: 'knowledge_items', id: 1, action: 'verify',
    expectedUpdatedAt: '2026-10-16T10:00:00Z' }, 'operator-1'), { ok: true });
  assert.equal(calls[1][0], 'crm_knowledge_review_v1');
  assert.equal(calls[1][1].p_actor_uid, 'operator-1');
  assert.equal(calls[1][1].p_expected_updated_at, '2026-10-16T10:00:00Z');
});

test('only verified current sourced evidence with confidence enters meeting prep; cases and stories stay separate', async () => {
  const evidence = [
    { id: 1, item_type: 'evidence', lifecycle_status: 'verified', verified: true, source: 'contract',
      content: 'Benefit clause', confidence: 0.9 },
    { id: 2, item_type: 'evidence', lifecycle_status: 'verified', verified: true, source: 'old source',
      content: 'Expired', confidence: 0.9, valid_to: '2026-10-15' },
    { id: 3, item_type: 'evidence', lifecycle_status: 'draft', verified: false, source: 'pending',
      content: 'Pending', confidence: 0.95 },
    { id: 4, item_type: 'case', lifecycle_status: 'verified', verified: true, source: 'case source',
      content: 'Case', confidence: 0.99 },
  ];
  const playbooks = [{ id: 8, lifecycle_status: 'verified', source: 'reviewed guide', confidence: 0.9,
    scenario: 'Claims', objection: 'service', response_logic: 'Check contract',
    evidence_refs: [1], case_refs: [4], story_refs: [] }];
  const request = async (table, method, filters = {}) => {
    if (table === 'persons') return [{ id: 10, display_name: 'Test' }];
    if (table === 'knowledge_items') return evidence.filter(row => row.lifecycle_status === 'verified');
    if (table === 'playbooks') return playbooks;
    if (['relationships', 'context_items', 'opportunities', 'actions', 'commitments', 'customers',
      'households', 'household_members'].includes(table)) return [];
    throw new Error(`Unexpected table ${table}`);
  };
  const builder = new MeetingPrepContextBuilder({ request, listInteractions: async () => ({ rows: [] }),
    insuranceContext: async () => ({}), now: () => new Date('2026-10-16T12:00:00Z') });
  const context = await builder.build(10, { objection: 'service', scenario: 'Claims' });
  assert.deepEqual(context.relevant_playbook.content.reliable_evidence.map(row => row.reference.id), [1]);
  assert.equal(context.relevant_playbook.content.relevant_playbooks.length, 1);
  assert.deepEqual(context.relevant_playbook.content.relevant_playbooks[0].evidence.map(row => row.reference.id), [1]);
  assert.equal(context.relevant_playbook.status, 'available');
  const unmatched = await builder.build(10, { objection: 'unrelated objection' });
  assert.deepEqual(unmatched.relevant_playbook.content.relevant_playbooks, []);
});

test('review RPC rejects missing human identity and fixture references are never caller-selected', async () => {
  let calls = 0;
  const service = new KnowledgeGovernanceService({ request: async () => { calls++; return []; }, rpc: async () => ({}) });
  await assert.rejects(service.review({ table: 'knowledge_items', id: 1, action: 'verify', expectedUpdatedAt: 'x' }, ''), /Invalid review request/);
  await assert.rejects(service.createFixtures('operator-1'), /Tracked fictional Person required/);
  assert.equal(calls, 1);
});
