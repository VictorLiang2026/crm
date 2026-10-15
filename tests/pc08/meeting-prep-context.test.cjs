'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MeetingPrepContextBuilder } = require('../../cloudfunctions/person_360/meeting-prep-context');
const { InsuranceContextService } = require('../../cloudfunctions/person_360/insurance-context-service');
const { defaultRegistry } = require('../../cloudfunctions/_shared/skill-registry');

function familyFixture() {
  const data = {
    persons: [{ id: 1, display_name: 'Person', occupation: null, organization: null },
      { id: 2, display_name: 'Anchor' }, { id: 3, display_name: 'Confirmed family' }],
    customers: [],
    households: [
      { id: 10, anchor_person_id: 1, important_facts: 'Legacy unreviewed', important_facts_confirmed_at: null, important_facts_confirmed_by_uid: null },
      { id: 20, anchor_person_id: 2, important_facts: 'Confirmed family fact', important_facts_confirmed_at: '2026-10-01T00:00:00Z', important_facts_confirmed_by_uid: 'reviewer' },
    ],
    household_members: [
      { id: 101, household_id: 20, person_id: 1, relationship_to_anchor: 'child', confirmed_at: '2026-10-01T00:00:00Z' },
      { id: 102, household_id: 20, person_id: 3, relationship_to_anchor: 'spouse', confirmed_at: null },
    ],
    relationships: [], context_items: [], opportunities: [], actions: [], commitments: [],
    products: [], policy_review_reports: [], ocr_records: [], photos: [], crm_opportunity_action_links: [], interactions: [],
  };
  async function request(table, method, filters = {}) {
    assert.equal(method, 'GET');
    let rows = data[table] || [];
    if (filters.id?.startsWith('eq.')) rows = rows.filter(row => String(row.id) === filters.id.slice(3));
    if (filters.id?.startsWith('in.')) rows = rows.filter(row => filters.id.includes(String(row.id)));
    if (filters.person_id?.startsWith('eq.')) rows = rows.filter(row => String(row.person_id) === filters.person_id.slice(3));
    if (filters.anchor_person_id) rows = rows.filter(row => String(row.anchor_person_id) === filters.anchor_person_id.slice(3));
    if (filters.household_id) rows = rows.filter(row => String(row.household_id) === filters.household_id.slice(3));
    if (filters.item_type) rows = rows.filter(row => row.item_type === filters.item_type.slice(3));
    if (filters.deleted_at === 'is.null' && ['households','household_members'].includes(table)) rows = rows.filter(row => !row.deleted_at);
    if (filters.confirmed_at === 'not.is.null') rows = rows.filter(row => row.confirmed_at);
    return rows;
  }
  return { data, request };
}

test('meeting preparation receives all verified household relationships and facts only', async () => {
  const { request } = familyFixture();
  const builder = new MeetingPrepContextBuilder({ request, listInteractions: async () => ({ rows: [] }),
    insuranceContext: async () => ({}), now: () => new Date('2026-10-15T00:00:00Z') });
  const context = await builder.build(1);
  assert.equal(defaultRegistry.validateContext('meeting_prep', context), true);
  assert.equal(context.household.households.length, 2);
  assert.ok(context.household.members.some(row => row.relationship_to_anchor === 'anchor'));
  assert.ok(!JSON.stringify(context).includes('Legacy unreviewed'));
  assert.ok(JSON.stringify(context).includes('Confirmed family fact'));
  assert.ok(context.household.important_facts === 'Confirmed family fact' || context.household.important_facts === '');
});

test('insurance preparation receives only confirmed household context', async () => {
  const { request } = familyFixture();
  const result = await new InsuranceContextService({ request }).build({ id: 1 });
  assert.deepEqual(result.householdContext.facts.map(row => row.content), ['Confirmed family fact']);
  assert.ok(!JSON.stringify(result.householdContext).includes('Legacy unreviewed'));
  assert.ok(!result.householdContext.members.some(row => row.person_id === 3));
});
