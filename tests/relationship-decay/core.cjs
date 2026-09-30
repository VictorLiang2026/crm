'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRelationshipDecay } = require('../../cloudfunctions/person_360/relationship-decay-core');

const now = '2026-10-01T00:00:00Z';
const weekly = ['2026-08-01T00:00:00Z','2026-08-08T00:00:00Z',
  '2026-08-15T00:00:00Z','2026-08-22T00:00:00Z'];

test('elapsed time alone cannot produce a decay signal', () => {
  const result = evaluateRelationshipDecay({ now, interactionTimes: weekly });
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.confidence, 0);
  assert.match(result.why, /关系强度/);
  assert.match(result.why, /重要互动/);
});

test('the same elapsed time has different outcomes for different historical rhythms', () => {
  const common = { now, strength: 'high', importance: 5,
    lastMeaningfulAt: '2026-09-01T00:00:00Z', meaningfulSource: 'explicit',
    importanceSource: 'explicit' };
  const fast = evaluateRelationshipDecay({ ...common, interactionTimes: weekly });
  const slow = evaluateRelationshipDecay({ ...common,
    interactionTimes: ['2026-01-01T00:00:00Z','2026-03-01T00:00:00Z',
      '2026-05-01T00:00:00Z','2026-07-01T00:00:00Z'] });
  assert.equal(fast.status, 'signal');
  assert.equal(slow.status, 'stable');
  assert.ok(fast.evidence.observation_days < slow.evidence.observation_days);
  assert.match(fast.recommended_action, /由人决定/);
});

test('strength and importance change the observation boundary', () => {
  const base = { now, interactionTimes: ['2026-07-01T00:00:00Z',
    '2026-07-21T00:00:00Z','2026-08-10T00:00:00Z','2026-08-30T00:00:00Z'],
    lastMeaningfulAt: '2026-08-25T00:00:00Z' };
  const important = evaluateRelationshipDecay({ ...base, strength: 'high', importance: 'high' });
  const low = evaluateRelationshipDecay({ ...base, strength: 'low', importance: 'low' });
  assert.ok(important.evidence.observation_days < low.evidence.observation_days);
});

test('sparse, duplicate-day and out-of-range observations never invent a cadence', () => {
  const result = evaluateRelationshipDecay({ now, strength: 'high', importance: 4,
    lastMeaningfulAt: '2026-09-01T00:00:00Z',
    interactionTimes: ['2026-08-01T00:00:00Z','2026-08-01T04:00:00Z',
      '2028-01-01T00:00:00Z','2020-01-01T00:00:00Z'] });
  assert.equal(result.status, 'insufficient_evidence');
});

test('sales-priority proxy lowers confidence without being reported as a fact', () => {
  const base = { now, strength: 'high', importance: 5, interactionTimes: weekly,
    lastMeaningfulAt: '2026-09-01T00:00:00Z', meaningfulSource: 'explicit' };
  const explicit = evaluateRelationshipDecay({ ...base, importanceSource: 'explicit' });
  const proxy = evaluateRelationshipDecay({ ...base, importanceSource: 'sales_priority_proxy' });
  assert.ok(proxy.confidence < explicit.confidence);
  assert.equal(proxy.evidence.importance_source, 'sales_priority_proxy');
});
