'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('person directory SQL qualifies every allowlisted sort expression', () => {
  const file = path.resolve(__dirname, '../../cloudbase/migrations/20261012130000_person_directory_sort_qualification.sql');
  const sql = fs.readFileSync(file, 'utf8');
  for (const [field, expression] of [
    ['id', 'p.id'], ['display_name', 'p.display_name'], ['updated_at', 'p.updated_at'],
    ['sales_priority', 'p.sales_priority'], ['recruitment_priority', 'rc.recruitment_priority'],
    ['referral_priority', 'p.referral_priority'],
    ['latest_followup_date', 'f.latest_followup_date'], ['next_followup_date', 'f.next_followup_date'],
  ]) assert.ok(sql.includes(`WHEN '${field}' THEN '${expression}'`), `unqualified sort field: ${field}`);
  assert.ok(sql.includes('NULLS LAST, p.id'));
  assert.match(sql, /current_user <> 'service_role'/);
});

test('filtered person directory SQL validates filters and limits execution to service_role', () => {
  const root = path.resolve(__dirname, '../..');
  const sql = fs.readFileSync(path.join(root, 'cloudbase/migrations/20261012140000_person_directory_filters.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(root, 'cloudbase/migrations/20261012140000_person_directory_filters.rollback.sql'), 'utf8');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.person_directory_filtered_page_v1/);
  assert.match(sql, /current_user <> 'service_role'/);
  assert.match(sql, /public\.person_roles/);
  assert.match(sql, /p\.sales_priority = ANY\(p_customer_priorities\)/);
  assert.match(sql, /rc\.recruitment_priority = ANY\(p_recruit_priorities\)/);
  assert.match(sql, /p\.referral_priority = ANY\(p_referral_priorities\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.person_directory_filtered_page_v1/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.person_directory_filtered_page_v1[\s\S]*TO service_role/);
  assert.match(rollback, /DROP FUNCTION public\.person_directory_filtered_page_v1/);
  assert.doesNotMatch(sql, /\b(?:FROM|JOIN)\s+pr\./i);
});

