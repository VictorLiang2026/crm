'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { unwrap, evaluate } = require('./run.cjs');
const { classify, emptyFunnelMetrics } = require('./gateway-probe.cjs');

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
    ['persons', snapshot => { object(snapshot, 'persons').detail.privileges.anon = ['SELECT']; }, /Server-only table exposed/],
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
});
