/** WP02 prepares a read-only seed gate. Actual insertion is deliberately unavailable. */
'use strict';
const {TABLES,MARKER,BATCH} = require('./test-data');
const AUDIT = new Set(['ai_tasks','ai_runs','ai_results']);
function fail(code) { const error = new Error(code); error.code=code; throw error; }
function previewPlan(batchKey, plan, manifest) {
  if (!BATCH.test(batchKey || '') || !Array.isArray(plan) || !Array.isArray(manifest)) fail('INVALID_PLAN');
  const initial = manifest.filter(row => row.origin === 'initial');
  if (initial.length > 10 || new Set(initial.map(r => r.initial_slot)).size !== initial.length ||
      initial.some(r => !Number.isInteger(r.initial_slot) || r.initial_slot < 1 || r.initial_slot > 10)) fail('INVALID_MANIFEST');
  const keys = new Map(initial.filter(r => r.batch_key === batchKey).map(r => [r.seed_key,r]));
  const flattened = [], seen = new Set();
  // Both primary writes and synchronously generated business rows consume slots.
  function expand(row) {
    if (!row || !TABLES.has(row.table) || AUDIT.has(row.table) ||
        !/^[a-z][a-z0-9_]{0,63}$/.test(row.seedKey || '') || seen.has(row.seedKey) ||
        typeof row.visibleText !== 'string' || !row.visibleText.includes(MARKER) ||
        row.outbound !== false || !Array.isArray(row.effects)) fail('INVALID_PLAN');
    seen.add(row.seedKey);
    const existing = keys.get(row.seedKey);
    if (existing && existing.record_table !== row.table) fail('IDEMPOTENCY_CONFLICT');
    flattened.push({table:row.table,seedKey:row.seedKey,existing:Boolean(existing)});
    row.effects.forEach(expand);
  }
  plan.forEach(expand);
  const added = flattened.filter(r => !r.existing);
  if (initial.length + added.length > 10) fail('INITIAL_LIMIT_EXCEEDED');
  return {ok:true,mode:'dry-run',batchKey,initialExisting:initial.length,initialNew:added.length,
    initialTotal:initial.length+added.length,maximum:10,
    rows:flattened,derivedAndAuditExisting:manifest.length-initial.length,
    businessDataWritten:false,executionEnabled:false};
}
async function seedRequest(event, identity, {allowedUids=[],loadManifest,loadScenario} = {}) {
  if (identity?.isAnonymous !== false || typeof identity.uid !== 'string' ||
      !allowedUids.includes(identity.uid)) fail('SEED_FORBIDDEN');
  if (event?.stage !== 'dryRun') fail('SEED_EXECUTION_DISABLED');
  if (!loadManifest || !loadScenario) fail('SEED_SCENARIO_NOT_CONFIGURED');
  // Plan and manifest are built/read by the server, never taken from event.plan/count/confirmed.
  const manifest = await loadManifest();
  const scenario = await loadScenario(event.scenario);
  return previewPlan(scenario.batchKey,scenario.rows,manifest);
}
module.exports={previewPlan,seedRequest};

