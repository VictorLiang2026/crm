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

