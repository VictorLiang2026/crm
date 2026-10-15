'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(root, 'cloudbase/migrations/20261015130000_household_lifecycle.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'cloudbase/migrations/20261015130000_household_lifecycle.rollback.sql'), 'utf8');

test('PC08 migration stays additive and restricts all new write commands to service_role', () => {
  assert.match(migration, /ALTER TABLE public\.households\s+ADD COLUMN important_facts_confirmed_at/);
  assert.match(migration, /CREATE TABLE public\.crm_household_commands/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY[\s\S]*FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.crm_household_preview_v1[\s\S]*FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.crm_household_preview_v1[\s\S]*TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.crm_household_execute_v1[\s\S]*TO service_role/);
  assert.doesNotMatch(migration, /\b(?:pr|pr_[a-z0-9_]+)\b/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.persons/i);
  assert.match(migration, /VALUES\([^;]*'derived'/s);
});

test('paired rollback refuses to discard executed family changes or confirmation history', () => {
  assert.match(rollback, /status='executed'/);
  assert.match(rollback, /important_facts_confirmed_at IS NOT NULL/);
  assert.match(rollback, /DROP TABLE public\.crm_household_commands/);
  assert.match(rollback, /DROP COLUMN important_facts_confirmed_by_uid/);
});
