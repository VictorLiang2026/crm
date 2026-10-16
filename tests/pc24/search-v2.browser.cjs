'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('Console search uses V2, waits for Person choice, and presents server pagination/evidence',()=>{
  const ui=read('crm/js/modules/console/pages/misc.js');
  const api=read('crm/js/modules/console/data.js');
  const i18n=read('crm/js/modules/console/i18n.js');
  assert.match(ui,/data\.aiSearchV2/);assert.match(ui,/needs_person_selection/);
  assert.match(ui,/selectedPersonId=String\(select\.value\)/);assert.match(ui,/search_v2_next/);
  assert.match(ui,/reason\.records/);assert.match(ui,/search_v2_time_note/);assert.match(api,/action: 'searchV2'/);
  for(const key of ['search_v2_choose_person','search_v2_evidence','search_v2_test_data','search_v2_unverified']) {
    const entry=i18n.match(new RegExp(`'${key}': \\{[^\\n]+`));
    assert.ok(entry,`missing ${key}`);assert.match(entry[0],/'zh-CN'/);assert.match(entry[0],/'en'/);
  }
});

test('PC24 migration is public-only fixed SQL with service-role execution and reversible scope',()=>{
  const sql=read('cloudbase/migrations/20261017123000_pc_combination_search.sql');
  const down=read('cloudbase/migrations/20261017123000_pc_combination_search.rollback.sql');
  assert.match(sql,/CREATE FUNCTION public\.crm_search_people_v2/);
  assert.match(sql,/SECURITY INVOKER/);assert.match(sql,/GRANT EXECUTE[^;]+service_role/s);
  assert.match(sql,/status='confirmed' AND x\.confirmed_at IS NOT NULL/);
  assert.match(sql,/ap\.status='attended'/);assert.match(sql,/p_offset/);
  assert.doesNotMatch(sql,/EXECUTE\s+format|\bpr\.|\bpr_[a-z]/i);
  assert.match(down,/DROP FUNCTION IF EXISTS public\.crm_search_people_v2/);
  assert.doesNotMatch(down,/DROP TABLE|DELETE FROM|TRUNCATE/i);
});
