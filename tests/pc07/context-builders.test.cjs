'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MeetingPrepContextBuilder } = require('../../cloudfunctions/person_360/meeting-prep-context');
const { buildCandidateContext } = require('../../cloudfunctions/assistant/opportunity-candidate-context');

const fixedNow = new Date('2026-10-15T12:00:00Z');
function items() {
  return [
    { id: 1, item_type: 'fact', category: 'needs', content: 'Interested in education', confirmed: true },
    { id: 2, item_type: 'fact', category: 'insurance', content: 'Asked about coverage', confirmed: true },
    { id: 3, item_type: 'fact', category: 'insurance', content: 'Does not want coverage', confirmed: true },
    { id: 4, item_type: 'fact', category: 'needs', content: 'Candidate need', confirmed: false },
    { id: 5, item_type: 'fact', category: 'old', content: 'Expired fact', confirmed: true, valid_to: '2026-10-14T00:00:00Z' },
    { id: 6, item_type: 'signal', category: 'interest', content: 'Possible interest', confirmed: false },
    { id: 7, item_type: 'inference', category: 'motivation', content: 'Possible motive', confirmed: true },
  ];
}

function requestForContext(rows) {
  return async (table) => {
    const data = {
      persons: [{ id: 71, display_name: 'Fictional Person', occupation: null, organization: null }],
      customers: [], households: [], household_members: [], relationships: [],
      context_items: rows, opportunities: [], actions: [], commitments: [],
    };
    return data[table] || [];
  };
}

test('meeting prep only sends confirmed current non-conflicting facts as facts', async () => {
  const builder = new MeetingPrepContextBuilder({ request: requestForContext(items()),
    listInteractions: async () => ({ rows: [] }), insuranceContext: async () => ({}), now: () => fixedNow });
  const result = await builder.build(71);
  assert.deepEqual(result.facts.map(row => row.content), ['Interested in education']);
  assert.ok(result.signals.some(row => row.certainty === 'uncertain_inference'));
  assert.ok(!JSON.stringify(result).includes('Asked about coverage'));
  assert.ok(!JSON.stringify(result).includes('Candidate need'));
  assert.ok(!result.facts.some(row => row.content === 'Expired fact'));
});

test('opportunity evidence treats only confirmed current unconflicted Facts as primary', async () => {
  const rows = items();
  const data = { read: async (table) => {
    if (table === 'persons') return [{ id: 71, display_name: 'Fictional Person' }];
    if (table === 'customers') return [];
    if (table === 'context_items') return rows;
    return [];
  } };
  const result = await buildCandidateContext(data, 71);
  const facts = result.evidence.filter(row => row.ref.startsWith('public.context_items#'));
  assert.deepEqual(facts.filter(row => row.primary).map(row => row.ref), ['public.context_items#1']);
  assert.ok(!facts.some(row => row.ref.endsWith('#2') || row.ref.endsWith('#3')),
    'conflicting facts must not be sent to the model');
  assert.ok(!facts.some(row => row.ref.endsWith('#4')),'unconfirmed Fact candidates stay in the human review UI');
  assert.ok(facts.some(row => row.certainty === 'unverified_signal' && !row.primary));
  assert.ok(facts.some(row => row.certainty === 'uncertain_inference' && !row.primary));
  assert.ok(!facts.some(row => row.ref.endsWith('#5')));
});
