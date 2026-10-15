'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HouseholdService } = require('../../cloudfunctions/person_360/household-service');
const { HouseholdContextService } = require('../../cloudfunctions/person_360/household-context');

test('Person home keeps singular compatibility while returning all confirmed household links', async () => {
  const groups = [
    { id: 10, anchor_person_id: 1, important_facts: 'legacy unconfirmed', updated_at: '2026-10-01' },
    { id: 20, anchor_person_id: 2, important_facts: null, updated_at: '2026-10-02' },
  ];
  const people = [{ id: 1, display_name: 'Anchor' }, { id: 2, display_name: 'Other anchor' }, { id: 3, display_name: 'Current Person' }];
  const members = [
    { id: 100, household_id: 10, person_id: 3, relationship_to_anchor: 'child', confirmed_at: '2026-10-03' },
    { id: 101, household_id: 10, person_id: 4, relationship_to_anchor: 'spouse', confirmed_at: null },
    { id: 200, household_id: 20, person_id: 3, relationship_to_anchor: 'sibling', confirmed_at: '2026-10-04' },
  ];
  const service = new HouseholdService({
    request: async (table, method, filters) => {
      assert.equal(method, 'GET');
      if (table === 'persons' && filters.id?.startsWith('eq.')) return people.filter(row => String(row.id) === filters.id.slice(3));
      if (table === 'persons' && filters.id?.startsWith('in.')) return people.filter(row => filters.id.includes(String(row.id)));
      if (table === 'households' && filters.anchor_person_id) return groups.filter(row => String(row.anchor_person_id) === filters.anchor_person_id.slice(3));
      if (table === 'households' && filters.id?.startsWith('in.')) return groups.filter(row => filters.id.includes(String(row.id)));
      if (table === 'household_members' && filters.person_id) return members.filter(row => String(row.person_id) === filters.person_id.slice(3));
      if (table === 'household_members' && filters.household_id) return members.filter(row => String(row.household_id) === filters.household_id.slice(3));
      return [];
    }, rpc: async () => { throw new Error('RPC should not run during reads'); },
  });
  const result = await service.listForPerson(3);
  assert.equal(result.households.length, 2);
  assert.equal(result.household.id, 10);
  assert.equal(result.households[0].members.find(row => row.id === 101).confirmed_at, null);
  assert.equal(result.households[0].anchor.display_name, 'Anchor');
  assert.equal(result.households[1].currentMembership.relationship_to_anchor, 'sibling');
});

test('household mutation preview requires server resolved identity and actor-bound RPC', async () => {
  const rpcCalls = [];
  const service = new HouseholdService({ request: async (table, method, filters) => {
    if (table === 'persons') return filters.name_key ? [{ id: 2, name_key: 'person', display_name: 'Person' }] : [];
    if (table === 'customers') return [];
    return [];
  }, rpc: async (name, args) => { rpcCalls.push({ name, args }); return { previewId: '0a8e3e68-0e2b-4e56-8c1d-7b4dd7fe5567' }; } });
  await assert.rejects(service.preview(1, 'add_member', {
    idempotencyKey: '0a8e3e68-0e2b-4e56-8c1d-7b4dd7fe5567', memberId: '3', memberName: 'Person', relationship: 'spouse',
  }, 'actor-1'), /not in the current identity results/);
  const result = await service.preview(1, 'add_member', {
    idempotencyKey: '0a8e3e68-0e2b-4e56-8c1d-7b4dd7fe5567', memberId: '2', memberName: 'Person', relationship: 'spouse',
  }, 'actor-1');
  assert.equal(result.previewId, '0a8e3e68-0e2b-4e56-8c1d-7b4dd7fe5567');
  assert.equal(rpcCalls[0].name, 'crm_household_preview_v1');
  assert.equal(rpcCalls[0].args.p_actor_uid, 'actor-1');
  assert.equal(rpcCalls[0].args.p_person_id, 1);
});

test('AI family context includes only confirmed current members and confirmed facts across households', async () => {
  const request = async (table, method, filters) => {
    assert.equal(method, 'GET');
    if (table === 'households' && filters.anchor_person_id) return [
      { id: 10, anchor_person_id: 1, important_facts: 'Legacy family data', important_facts_confirmed_at: null, important_facts_confirmed_by_uid: null },
    ];
    if (table === 'household_members' && filters.person_id) return [
      { id: 101, household_id: 20, person_id: 1, relationship_to_anchor: 'child', confirmed_at: '2026-10-01' },
    ];
    if (table === 'households' && filters.id) return [
      { id: 10, anchor_person_id: 1, important_facts: 'Legacy family data', important_facts_confirmed_at: null, important_facts_confirmed_by_uid: null },
      { id: 20, anchor_person_id: 2, important_facts: 'Confirmed family fact', important_facts_confirmed_at: '2026-10-01', important_facts_confirmed_by_uid: 'uid-1' },
    ];
    if (table === 'household_members' && filters.household_id) return filters.household_id === 'eq.20' ? [
      { id: 101, person_id: 1, relationship_to_anchor: 'child', confirmed_at: '2026-10-01' },
      { id: 102, person_id: 3, relationship_to_anchor: 'spouse', confirmed_at: null },
    ] : [];
    if (table === 'persons' && filters.id?.startsWith('in.')) return [
      { id: 1, display_name: 'Person' }, { id: 2, display_name: 'Anchor' },
    ];
    return [];
  };
  const context = await new HouseholdContextService({ request }).build(1);
  assert.equal(context.households.length, 2);
  assert.deepEqual(context.facts.map(row => row.content), ['Confirmed family fact']);
  assert.ok(!JSON.stringify(context).includes('Legacy family data'));
  assert.ok(!context.members.some(row => row.person_id === 3));
  assert.ok(context.members.some(row => row.person_id === 2 && row.relationship_to_anchor === 'anchor'));
});
