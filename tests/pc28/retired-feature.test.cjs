'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('natural-language recruit delete has no UI, data or assistant route',()=>{
  assert.doesNotMatch(read('crm/js/modules/console/pages/recruit.js'),/recruitDelete|pc28_/);
  assert.doesNotMatch(read('crm/js/modules/console/data.js'),/recruitDelete/);
  assert.doesNotMatch(read('crm/js/modules/console/i18n.js'),/pc28_/);
  assert.doesNotMatch(read('cloudfunctions/assistant/index.js'),/recruitDelete|RECRUIT_DELETE/);
  assert.doesNotMatch(read('cloudfunctions/assistant/skill-registry.js'),/assistant_recruit_delete_v1/);
  for(const file of ['crm/js/modules/console/recruit-delete.js','cloudfunctions/assistant/recruit-delete-intent-service.js',
    'cloudfunctions/assistant/recruit-delete-command-service.js','cloudfunctions/assistant/recruit-delete-command-data.js'])
    assert.equal(fs.existsSync(path.join(root,file)),false,file);
});

test('standard recruit profile edit and recycle-bin delete remain available',()=>{
  assert.match(read('crm/js/modules/console/recruit-write.js'),/openRecruitCandidateRemove/);
  assert.match(read('crm/js/modules/console/recruit-write.js'),/recruit_profile_edit/);
  assert.match(read('crm/js/modules/console/pages/recruit.js'),/openRecruitCandidateCreate/);
});

test('retirement migrations remove the RPC and preserve the audit table and rows',()=>{
  const migration=read('cloudbase/migrations/20261112224500_retire_assistant_recruit_delete.sql');
  const rollback=read('cloudbase/rollbacks/20261112224500_retire_assistant_recruit_delete.sql');
  const drop=read('cloudbase/migrations/20261112233000_drop_assistant_recruit_delete_rpc.sql');
  const restore=read('cloudbase/rollbacks/20261112233000_drop_assistant_recruit_delete_rpc.sql');
  assert.match(migration,/REVOKE INSERT, UPDATE ON public\.assistant_recruit_delete_commands FROM service_role/);
  assert.match(migration,/REVOKE ALL ON FUNCTION public\.assistant_recruit_delete_command_v1/);
  assert.match(drop,/DROP FUNCTION public\.assistant_recruit_delete_command_v1/);
  assert.match(restore,/CREATE FUNCTION public\.assistant_recruit_delete_command_v1/);
  assert.match(restore,/REVOKE ALL ON FUNCTION public\.assistant_recruit_delete_command_v1[\s\S]*FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(migration+rollback+drop+restore,/DROP TABLE|DELETE FROM public\.assistant_recruit_delete_commands/);
  assert.match(rollback,/GRANT INSERT, UPDATE ON public\.assistant_recruit_delete_commands TO service_role/);
  assert.match(rollback,/GRANT EXECUTE ON FUNCTION public\.assistant_recruit_delete_command_v1/);
});
