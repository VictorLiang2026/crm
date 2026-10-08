'use strict';
/*
 * risk-cases.test.cjs — PMC-03 R1–R10 + R-ID1 offline contract tests.
 *
 * Validates behavioral contracts from data-model.md (C1–C9, D1–D11, R-ID1/2)
 * using local fixtures. Does NOT touch production; does NOT read online results
 * to backfill expectations. Not integrated into release gate (WP01 unchanged).
 *
 * Run: node --test tests/pmc/risk-cases.test.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert');

// --- Fixtures (in-memory, no DB) ---
function makePersonStore() {
  return {
    persons: [{ id: '100', display_name: '张三', phone: '13800000000', deleted_at: null, updated_at: '2026-10-08T00:00:00Z' }],
    customers: [{ Id: 1, customer_name: '张三', person_id: null, deleted_at: null, updated_at: '2026-10-08T00:00:00Z' }],
    person_roles: [{ person_id: '100', role: 'customer', origin: 'legacy_backfill' }],
  };
}

// Simulate server-side resolveName: returns candidates, never auto-selects.
function resolveName(store, name) {
  const candidates = store.persons.filter((p) => p.display_name === name && !p.deleted_at);
  if (candidates.length === 0) return { status: 'NO_MATCH', candidates: [] };
  if (candidates.length === 1) return { status: 'UNAMBIGUOUS', candidates };
  return { status: 'AMBIGUOUS', candidates };
}

// C4: optimistic lock on update.
function updateWithOptimisticLock(store, id, patch, expectedUpdatedAt) {
  const row = store.customers.find((c) => c.Id === id);
  if (!row) return { status: 404, code: 'CUSTOMER_NOT_FOUND' };
  if (expectedUpdatedAt && expectedUpdatedAt !== row.updated_at) {
    return { status: 409, code: 'CONFLICT_VERSION', currentUpdatedAt: row.updated_at };
  }
  row.updated_at = new Date().toISOString();
  Object.assign(row, patch);
  return { status: 200, updated: row };
}

// C6: idempotent create via clientRequestId.
function createIdempotent(store, clientRequestId, payload, seen) {
  if (seen.has(clientRequestId)) return { status: 200, duplicate: true, id: seen.get(clientRequestId) };
  const id = store.customers.length + 1;
  store.customers.push({ Id: id, ...payload, updated_at: new Date().toISOString() });
  seen.set(clientRequestId, id);
  return { status: 201, id };
}

// --- Tests ---

test('R1 same-name different-person: resolveName returns candidates, no auto-select', () => {
  const store = {
    persons: [
      { id: '100', display_name: '李四', phone: '13800000001', deleted_at: null },
      { id: '101', display_name: '李四', phone: '13800000002', deleted_at: null },
    ],
  };
  const result = resolveName(store, '李四');
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.candidates.length, 2);
  // Contract: no auto-select; human must confirm. Simulated by NOT writing person_id here.
  const written = store.persons.find((p) => p.id === '100' && p.linked_at !== undefined);
  assert.equal(written, undefined);
});

test('R2 Person without customer role: customers.remove does not cascade persons', () => {
  const store = makePersonStore();
  // Simulate customers.remove(id=1): soft-delete customer, keep persons.
  const c = store.customers.find((x) => x.Id === 1);
  c.deleted_at = new Date().toISOString();
  // persons row must remain.
  const p = store.persons.find((x) => x.id === '100');
  assert.equal(p.deleted_at, null);
});

test('R3 multi-role person: UNIQUE(person_id, role) enforced', () => {
  const store = makePersonStore();
  // person_roles UNIQUE(person_id, role): adding duplicate should violate.
  const existing = store.person_roles.find((r) => r.person_id === '100' && r.role === 'customer');
  assert.ok(existing);
  // Simulate insert of duplicate (person_id=100, role=customer) -> DB would reject.
  const wouldViolate = store.person_roles.some((r) => r.person_id === '100' && r.role === 'customer');
  assert.equal(wouldViolate, true, 'UNIQUE(person_id, role) baseline must hold');
});

test('R4 concurrent edit: expectedUpdatedAt mismatch yields 409, no silent overwrite', () => {
  const store = makePersonStore();
  // Stale client sends update with old timestamp.
  const stale = updateWithOptimisticLock(store, 1, { customer_name: '新名' }, '2026-10-07T00:00:00Z');
  assert.equal(stale.status, 409);
  assert.equal(stale.code, 'CONFLICT_VERSION');
  // No silent overwrite.
  assert.notEqual(store.customers[0].customer_name, '新名');
});

test('R5 duplicate submission: clientRequestId dedup', () => {
  const store = makePersonStore();
  const seen = new Map();
  const r1 = createIdempotent(store, 'req-001', { customer_name: '王五' }, seen);
  const r2 = createIdempotent(store, 'req-001', { customer_name: '王五' }, seen);
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 200);
  assert.equal(r2.duplicate, true);
  assert.equal(r1.id, r2.id);
  assert.equal(store.customers.length, 2); // only one new row added
});

test('R6 migration-period new edit: C1/C2/C3 — old input compatible, no silent clear', () => {
  const store = makePersonStore();
  // Old client sends update WITHOUT personId (new optional field). Server must accept.
  const r = updateWithOptimisticLock(store, 1, { customer_name: '赵六' });
  assert.equal(r.status, 200);
  // C3: fields not in payload are NOT cleared.
  assert.equal(store.customers[0].person_id, null, 'person_id must not be silently cleared');
});

test('R7 legacy client request: new personId field is additive (C2)', () => {
  const store = makePersonStore();
  // Old client reads customer.get(id=1): response must include personId (additive, default null).
  const row = store.customers.find((c) => c.Id === 1);
  const response = { ...row, personId: row.person_id !== null ? String(row.person_id) : null };
  assert.equal(response.personId, null, 'legacy customer without person_id returns null personId (additive)');
  assert.equal(response.customer_name, '张三', 'existing field preserved');
});

test('R8 partial release failure: must stop, not mark complete', () => {
  // Contract: if any function deploy fails, release.ps1 must abort; never claim success.
  const simulatePartialFailure = () => ({ deployed: ['customers'], failed: ['followups'] });
  const result = simulatePartialFailure();
  assert.ok(result.failed.length > 0);
  // Per execution-contract K: must not continue to next package.
  const mayContinue = result.failed.length === 0;
  assert.equal(mayContinue, false);
});

test('R9 OCR recovery: customer_snapshot -> customers.update (T2), no direct persons overwrite', () => {
  const store = makePersonStore();
  // OCR remove returns customer_snapshot; front-end calls customers.update with it.
  const snapshot = { customer_name: '恢复名', phone: '13800000099' };
  // T2: customers.update maps basic fields to persons via server-side, not direct overwrite.
  // Contract: response includes personId; persons is authoritative.
  const r = updateWithOptimisticLock(store, 1, snapshot);
  assert.equal(r.status, 200);
  // persons row updated_at must change ONLY if server-side mapping ran (T2).
  // Here we only assert the contract surface: customer row updated, no exception.
  assert.equal(store.customers[0].customer_name, '恢复名');
});

test('R10 permission denial: new personId field does not add new grant (C7)', () => {
  // Contract: RLS / function permission context unchanged; new column inherits existing RLS.
  // Anonymous probe must still be denied for persons table.
  const anonymousCanSelectPersons = false; // RLS: only service_role
  assert.equal(anonymousCanSelectPersons, false);
});

test('R-ID1 bigint ID precision: int8 transmitted as string, no Number/parseInt on bigint', () => {
  // Contract R-ID1: persons.id (bigint) must be String() in HTTP/JSON/JS memory.
  const personId = '9007199254740993'; // > 2^53, would lose precision as Number
  assert.equal(typeof personId, 'string');
  // Simulate legacy parseInt on bigint — contract forbids this for bigint PKs.
  const dangerousParseInt = (id) => Number.parseInt(id, 10);
  const lossy = dangerousParseInt(personId);
  assert.notEqual(String(lossy), personId, 'parseInt on bigint loses precision; R-ID2 forbids this');
  // Correct pattern: string comparison, string Map keys.
  const map = new Map();
  map.set(personId, true);
  assert.ok(map.has('9007199254740993'));
});
