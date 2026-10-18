'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { catalog } = require('../wp01/run.cjs');

const file = path.resolve(__dirname, '../security/.results/wp01-catalog.json');
const sensitiveTables = [
  'actions', 'interactions', 'context_items', 'relationships',
  'outcomes', 'ai_result_feedback_events', 'ai_tasks', 'ai_runs', 'ai_results',
  'ai_request_claims', 'assistant_action_commands', 'assistant_opportunity_commands',
  'crm_work_item_commands', 'crm_relationship_commands', 'crm_opportunity_commands',
  'crm_activity_review_commands', 'crm_activity_review_source_claims',
  'crm_context_item_commands', 'crm_household_commands', 'crm_ocr_parse_commands',
  'crm_recruit_coach_outcome_commands', 'crm_opportunity_action_links',
  'person_identity_commands', 'person_delete_commands', 'quick_capture_v2_commands',
  'opportunity_candidates', 'crm_proactive_coach_decisions',
  'knowledge_items', 'playbooks', 'learnings'
];
const commandRoutines = [
  'assistant_action_command_v1', 'assistant_opportunity_command_v1',
  'crm_work_item_preview_v1', 'crm_work_item_execute_v1',
  'crm_relationship_preview_v1', 'crm_relationship_execute_v1',
  'crm_opportunity_preview_v1', 'crm_opportunity_execute_v1',
  'crm_activity_review_preview_v1', 'crm_activity_review_execute_v1',
  'crm_context_item_preview_v1', 'crm_context_item_execute_v1',
  'crm_household_preview_v1', 'crm_household_execute_v1',
  'crm_ocr_parse_preview_v1', 'crm_ocr_parse_execute_v1', 'crm_ocr_parse_undo_preview_v1',
  'crm_person_delete_preview_v1', 'crm_person_delete_execute_v1',
  'person_identity_preview_v1', 'person_identity_execute_v1',
  'quick_capture_v2_command_v1', 'crm_recruit_coach_outcome_v1',
  'opportunity_candidate_v1', 'crm_proactive_coach_decision_v1',
  'crm_ai_experience_decide_v1', 'crm_ai_experience_outcome_v1',
  'crm_ai_experience_learning_v1', 'crm_ai_experience_confirm_learning_v1',
  'crm_ai_claim_v2', 'crm_ai_finish_v1'
];

function readMatrix() {
  assert.ok(fs.existsSync(file), 'fresh public catalog snapshot required');
  const { actual, result } = catalog(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(result.failures, [], 'public catalog drift');
  return new Map(actual.objects.map(x => [`${x.kind}:${x.name}`, x.detail]));
}

test('PC34 public critical relations deny browser roles and allow scoped service access', () => {
  const matrix = readMatrix();
  for (const name of sensitiveTables) {
    const detail = matrix.get(`relation:${name}`);
    assert.ok(detail, `missing public.${name}`);
    assert.equal(detail.rls, true, `RLS public.${name}`);
    assert.deepEqual(detail.privileges.anon, [], `anon public.${name}`);
    assert.deepEqual(detail.privileges.authenticated, [], `authenticated public.${name}`);
    assert.ok(detail.privileges.service_role.includes('SELECT'), `service SELECT public.${name}`);
    assert.ok(detail.policies.every(p => p.roles.length === 1 && p.roles[0] === 'service_role'),
      `service-only policies public.${name}`);
  }
  const persons = matrix.get('relation:persons');
  assert.deepEqual(persons.privileges.anon, ['SELECT'], 'approved Person identity read exception');
  assert.deepEqual(persons.privileges.authenticated, []);
  assert.ok(persons.policies.some(p => p.roles.length === 1 && p.roles[0] === 'anon' && p.command === 'r'));
  const legacyOpportunity = matrix.get('relation:opportunities');
  assert.deepEqual(legacyOpportunity.privileges.anon, ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
    'preserved legacy opportunity channel');
  assert.deepEqual(legacyOpportunity.privileges.authenticated, []);
  assert.ok(legacyOpportunity.policies.some(p => p.roles.includes('anon')));
  const legacyDelete = [...matrix].filter(([key]) => key.startsWith('routine:crm_delete_batch('));
  assert.equal(legacyDelete.length, 1, 'legacy delete/restore RPC remains present');
  assert.equal(legacyDelete[0][1].anon_execute, true, 'preserved legacy anonymous gateway grant');
  assert.equal(legacyDelete[0][1].authenticated_execute, false);
  assert.equal(legacyDelete[0][1].service_execute, true);
});

test('PC34 command and AI audit RPCs execute only for service_role', () => {
  const matrix = readMatrix();
  for (const name of commandRoutines) {
    const entries = [...matrix].filter(([key]) => key.startsWith(`routine:${name}(`));
    assert.equal(entries.length, 1, `public.${name} exact overload`);
    const detail = entries[0][1];
    assert.equal(detail.anon_execute, false, `anon ${name}`);
    assert.equal(detail.authenticated_execute, false, `authenticated ${name}`);
    assert.equal(detail.service_execute, true, `service ${name}`);
    assert.equal(detail.security_definer, false, `invoker ${name}`);
  }
});

module.exports = { sensitiveTables, commandRoutines };
