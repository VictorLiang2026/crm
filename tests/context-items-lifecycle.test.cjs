'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyContextItems } = require('../cloudfunctions/_shared/context-facts');

const now = new Date('2026-10-15T12:00:00Z');

test('only confirmed current facts enter trusted facts', () => {
  const result = classifyContextItems([
    { id: 1, item_type: 'fact', category: 'need', content: 'College', confirmed: true },
    { id: 2, item_type: 'fact', category: 'need', content: 'Candidate', confirmed: false },
    { id: 3, item_type: 'fact', category: 'old', content: 'Expired', confirmed: true, valid_to: '2026-10-14T00:00:00Z' },
    { id: 4, item_type: 'signal', category: 'signal', content: 'Maybe', confirmed: true },
    { id: 5, item_type: 'inference', category: 'inference', content: 'Guess', confirmed: true },
  ], now);
  assert.deepEqual(result.trustedFacts.map(row => row.id), [1]);
  assert.deepEqual(result.factsToVerify.map(row => row.id), [2]);
  assert.deepEqual(result.signals.map(row => row.id), [4]);
  assert.deepEqual(result.inferences.map(row => row.id), [5]);
  assert.equal(result.current.some(row => row.id === 3), false);
});

test('different current facts in one category are all withheld from trusted context', () => {
  const result = classifyContextItems([
    { id: 1, item_type: 'fact', category: 'need', content: 'Interested', confirmed: true },
    { id: 2, item_type: 'fact', category: 'need', content: 'Not interested', confirmed: true },
    { id: 3, item_type: 'fact', category: 'career', content: 'Teacher', confirmed: true },
  ], now);
  assert.deepEqual(result.trustedFacts.map(row => row.id), [3]);
  assert.deepEqual(result.factsToVerify.map(row => row.id), [1, 2]);
  assert.deepEqual(result.conflictCategories, ['need']);
});

test('same statement with spacing differences is not treated as a conflict', () => {
  const result = classifyContextItems([
    { id: 1, item_type: 'fact', category: 'need', content: 'Interested   in college', confirmed: true },
    { id: 2, item_type: 'fact', category: 'need', content: ' interested in college ', confirmed: true },
  ], now);
  assert.equal(result.trustedFacts.length, 2);
  assert.equal(result.conflictCategories.length, 0);
});

test('saturated read withholds facts because older conflicting rows may be outside the page', () => {
  const result = classifyContextItems([
    { id: 1, item_type: 'fact', category: 'needs', content: 'Only visible row', confirmed: true },
  ], now, { truncated: true });
  assert.equal(result.trustedFacts.length, 0);
  assert.deepEqual(result.factsToVerify.map(row => row.id), [1]);
});

test('deployed function helper copies match the shared source', () => {
  const root = path.resolve(__dirname, '../cloudfunctions');
  const canonical = fs.readFileSync(path.join(root, '_shared/context-facts.js'), 'utf8');
  for (const fn of ['person_360', 'assistant']) {
    assert.equal(fs.readFileSync(path.join(root, fn, 'context-facts.js'), 'utf8'), canonical,
      `${fn}/context-facts.js must match _shared source`);
  }
});

test('paired PC07 migrations keep direct browser writes revoked and preserve audit on rollback', () => {
  const root = path.resolve(__dirname, '../cloudbase/migrations');
  const up = fs.readFileSync(path.join(root, '20261015100000_context_item_lifecycle.sql'), 'utf8');
  const down = fs.readFileSync(path.join(root, '20261015100000_context_item_lifecycle.rollback.sql'), 'utf8');
  assert.match(up, /CREATE TABLE public\.crm_context_item_commands/);
  assert.match(up, /REVOKE ALL ON public\.crm_context_item_commands FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(up, /GRANT EXECUTE ON FUNCTION public\.crm_context_item_execute_v1[^;]+ TO service_role/);
  assert.doesNotMatch(up, /GRANT .* TO (PUBLIC|anon|authenticated)/);
  assert.match(down, /rollback blocked: executed context history exists/);
  assert.match(down, /REVOKE UPDATE \(confirmed, confirmed_by_uid, confirmed_at, valid_to, last_verified_at\)/);
});
