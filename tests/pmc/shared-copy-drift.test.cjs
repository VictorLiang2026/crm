'use strict';
/*
 * shared-copy-drift.test.cjs — PMC-03 R11: detect drift in person-service.js copies.
 *
 * sync-shared.cjs MODULES only tracks db.js/ai.js. person-service.js has three
 * copies: cloudfunctions/_shared/, cloudfunctions/person_360/, cloudfunctions/assistant/.
 * This test computes SHA-256 for each and reports drift. Does NOT preset
 * "all three must match" — drift is reported as-is.
 *
 * Extending sync-shared.cjs MODULES to include person-service.js is PMC-04+
 * (shared module change requires separate authorization).
 *
 * Run: node --test tests/pmc/shared-copy-drift.test.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const COPIES = [
  { fn: '_shared', rel: 'cloudfunctions/_shared/person-service.js' },
  { fn: 'person_360', rel: 'cloudfunctions/person_360/person-service.js' },
  { fn: 'assistant', rel: 'cloudfunctions/assistant/person-service.js' },
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('R11 person-service.js copies: all three files exist', () => {
  for (const { fn, rel } of COPIES) {
    const p = path.join(ROOT, rel);
    assert.ok(fs.existsSync(p), `missing: ${rel}`);
    assert.ok(fs.statSync(p).isFile(), `not a file: ${rel}`);
  }
});

test('R11 person-service.js copies: SHA-256 drift report (no preset)', () => {
  const hashes = COPIES.map(({ fn, rel }) => {
    const p = path.join(ROOT, rel);
    return { fn, path: p, sha256: sha256(p) };
  });
  // Report all hashes to console for evidence.
  for (const h of hashes) console.log(`[R11] ${h.fn} sha256=${h.sha256}`);
  // Group by hash.
  const groups = new Map();
  for (const h of hashes) {
    if (!groups.has(h.sha256)) groups.set(h.sha256, []);
    groups.get(h.sha256).push(h.fn);
  }
  console.log(`[R11] ${groups.size} distinct hash group(s) across ${hashes.length} copies`);
  // If drift exists, report it; do not fail the test (drift is a finding, not a gate).
  // But: if _shared differs from both function copies, that is a strong drift signal.
  const sharedHash = hashes.find((h) => h.fn === '_shared').sha256;
  const driftCopies = hashes.filter((h) => h.sha256 !== sharedHash).map((h) => h.fn);
  if (driftCopies.length > 0) {
    console.log(`[R11] DRIFT: _shared differs from: ${driftCopies.join(', ')}`);
  } else {
    console.log('[R11] All three copies match _shared');
  }
  // Contract assertion: at minimum, the three files must be readable and hashable.
  assert.equal(hashes.length, 3);
  assert.ok(hashes.every((h) => h.sha256.length === 64));
});

test('R11 known gap: sync-shared.cjs MODULES does not include person-service.js', () => {
  const syncShared = fs.readFileSync(path.join(ROOT, 'tools/sync-shared.cjs'), 'utf8');
  // Document the gap: MODULES = ['db.js', 'ai.js']
  assert.ok(/MODULES\s*=\s*\[\s*['"]db\.js['"]\s*,\s*['"]ai\.js['"]\s*\]/.test(syncShared),
    'sync-shared.cjs MODULES must be db.js/ai.js (gap: person-service.js not tracked)');
  // This is a finding, not a fix. Extending MODULES is PMC-04+.
});
