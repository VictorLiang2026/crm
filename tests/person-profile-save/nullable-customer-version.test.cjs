'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(root,
  'cloudbase/migrations/20261106143000_person_profile_nullable_customer_version.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root,
  'cloudbase/rollbacks/20261106143000_person_profile_nullable_customer_version.rollback.sql'), 'utf8');

test('profile save treats a NULL customer timestamp as an explicit optimistic-lock version', () => {
  assert.match(migration, /IF p_customer_id IS NULL THEN[\s\S]*?Customer ID is required/);
  assert.match(migration, /v_customer\.updated_at IS DISTINCT FROM p_customer_expected_updated_at/);
  assert.doesNotMatch(migration, /p_customer_id IS NULL OR p_customer_expected_updated_at IS NULL/);
  assert.match(migration, /WHERE "Id" = p_customer_id AND person_id = p_person_id AND deleted_at IS NULL FOR UPDATE/);
  assert.match(migration, /'PROFILE_CONFLICT','scope','customer'/);
  assert.doesNotMatch(migration, /(?:\bpr\.|\bpr_[a-z0-9_]+)/i);
});

test('profile-save rollback restores the previous customer version requirement', () => {
  assert.match(rollback, /p_customer_id IS NULL OR p_customer_expected_updated_at IS NULL/);
  assert.match(rollback, /Customer ID and expected version are required/);
  assert.match(rollback, /v_customer\.updated_at <> p_customer_expected_updated_at/);
  assert.doesNotMatch(rollback, /(?:\bpr\.|\bpr_[a-z0-9_]+)/i);
});
