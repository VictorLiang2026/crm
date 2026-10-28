'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { unwrap, evaluate } = require('./run.cjs');
const { classify, emptyFunnelMetrics, observationCount } = require('./gateway-probe.cjs');

const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected-public-baseline.json'), 'utf8'));
const copy = () => structuredClone(expected);
const object = (snapshot, name) => snapshot.objects.find(item => item.name === name);

test('complete metadata snapshot passes and incomplete CloudBase result fails closed', () => {
  assert.deepEqual(evaluate(copy()).failures, []);
  assert.throws(() => unwrap({ success: true, data: { truncated: true, returnedRows: 1, rows: [{ snapshot: expected }] } }), /incomplete/);
  assert.throws(() => unwrap({ success: false, errorCode: 'DENIED' }), /failed/);
});

test('RLS, invoker, grants, and policy drift each fail', () => {
  const cases = [
    ['policy_review_reports', snapshot => { object(snapshot, 'policy_review_reports').detail.rls = false; }, /RLS disabled/],
    ['customers_view', snapshot => { object(snapshot, 'customers_view').detail.security_invoker = false; }, /View bypasses/],
    ['customers', snapshot => { object(snapshot, 'customers').detail.privileges.authenticated = ['SELECT']; }, /Authenticated table/],
    ['interactions', snapshot => { object(snapshot, 'interactions').detail.privileges.anon = ['SELECT']; }, /Server-only table exposed/],
    ['opportunities', snapshot => { object(snapshot, 'opportunities').detail.policies[0].using_hash = 'changed'; }, /policy drift/]
  ];
  for (const [name, change, pattern] of cases) {
    const snapshot = copy();
    change(snapshot);
    assert.match(evaluate(snapshot).failures.join('\n'), pattern, name);
  }
});

test('new or missing public objects cannot silently pass', () => {
  const added = copy();
  added.objects.push({ kind: 'relation', name: 'unexpected_table', detail: {} });
  assert.match(evaluate(added).failures.join('\n'), /Unapproved public object/);
  const missing = copy();
  missing.objects = missing.objects.filter(item => item.name !== 'customers');
  assert.match(evaluate(missing).failures.join('\n'), /Approved object missing/);
});

test('the PM18 routine exception is exact and cannot authorize other anon routines', () => {
  assert.deepEqual(evaluate(copy()).failures, []);
  const changedAcl = copy();
  object(changedAcl, 'pmc18_collect_once_v1()').detail.authenticated_execute = true;
  assert.match(evaluate(changedAcl).failures.join('\n'), /Routine permission exception mismatch: routine:pmc18_collect_once_v1\(\)/);
  const serviceAllowed = copy();
  object(serviceAllowed, 'pmc18_collect_once_v1()').detail.service_execute = true;
  assert.match(evaluate(serviceAllowed).failures.join('\n'), /Routine permission exception mismatch: routine:pmc18_collect_once_v1\(\)/);
  const anotherAnonRoutine = copy();
  object(anotherAnonRoutine, 'quick_capture_v2_command_v1(p_stage text, p_actor_uid text, p_command_id uuid, p_person_id bigint, p_selected_display_name text, p_draft jsonb, p_preview_hash text, p_ai_task_id bigint, p_ai_result_id bigint)').detail.service_execute = false;
  assert.match(evaluate(anotherAnonRoutine).failures.join('\n'), /Service routine execution missing: routine:quick_capture_v2_command_v1/);
});

test('anonymous gateway checks reject visible rows and nonzero aggregate facts', () => {
  assert.equal(classify(200, '*/0', true), true);
  assert.equal(classify(206, '0-0/1', true), false);
  assert.equal(classify(403, null, false), true);
  assert.equal(classify(200, '*/0', false), false);
  const row = Object.fromEntries(['current_count', 'entered_30d', 'moved_30d',
    'overdue_count', 'dwell_median_days', 'stuck_count'].map(name => [name, 0]));
  assert.equal(emptyFunnelMetrics([row]), true);
  assert.equal(emptyFunnelMetrics([{ ...row, current_count: 1 }]), false);
  assert.equal(emptyFunnelMetrics([{}]), false);
  assert.equal(observationCount('*/20'), 20);
  assert.equal(observationCount('*/40'), 40);
  assert.equal(observationCount('*/0'), null);
  assert.equal(observationCount('*/21'), null);
  assert.equal(observationCount('0-19/20'), null);
  assert.equal(observationCount(null), null);
});

test('Person profile transaction RPC is public-only, service-role-only, and reversibly scoped', () => {
  const signature = 'crm_person_profile_save_v1(p_actor_uid text, p_person_id bigint, p_person_expected_updated_at timestamp with time zone, p_person_fields jsonb, p_customer_id bigint, p_customer_expected_updated_at timestamp with time zone, p_customer_fields jsonb, p_recruit_id bigint, p_recruit_expected_updated_at timestamp with time zone, p_recruit_fields jsonb)';
  const routine = object(copy(), signature);
  assert.ok(routine, 'approved routine is recorded in the public catalog');
  assert.deepEqual(routine.detail, {
    anon_execute: false, service_execute: true, security_definer: false, authenticated_execute: false,
  });
  const root = path.resolve(__dirname, '../..');
  const migration = fs.readFileSync(path.join(root, 'cloudbase/migrations/20261028210000_person_profile_transaction.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(root, 'cloudbase/rollbacks/20261028210000_person_profile_transaction.rollback.sql'), 'utf8');
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.crm_person_profile_save_v1/);
  assert.match(migration, /SECURITY INVOKER[\s\S]*SET search_path = pg_catalog, public/);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /TO service_role/);
  assert.doesNotMatch(migration, /(?:\bpr\.|\bpr_[a-z0-9_]+)/i);
  const rollbackSql = rollback.replace(/\r\n/g, '\n').replace(/^\s*--.*$/gm, '').trim();
  assert.equal(rollbackSql, 'DROP FUNCTION IF EXISTS public.crm_person_profile_save_v1(\n  text,bigint,timestamptz,jsonb,bigint,timestamptz,jsonb,bigint,timestamptz,jsonb\n);');
});
