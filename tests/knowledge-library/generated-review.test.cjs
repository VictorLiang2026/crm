'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');
const up=fs.readFileSync(path.join(root,'cloudbase/migrations/20261030140000_knowledge_generated_review.sql'),'utf8');
const down=fs.readFileSync(path.join(root,'cloudbase/migrations/20261030140000_knowledge_generated_review.rollback.sql'),'utf8');
const targetUp=fs.readFileSync(path.join(root,'cloudbase/migrations/20261030143000_knowledge_review_target.sql'),'utf8');
const targetDown=fs.readFileSync(path.join(root,'cloudbase/migrations/20261030143000_knowledge_review_target.rollback.sql'),'utf8');
const invalidateUp=fs.readFileSync(path.join(root,'cloudbase/migrations/20261030144000_knowledge_summary_review_invalidation.sql'),'utf8');
const invalidateDown=fs.readFileSync(path.join(root,'cloudbase/migrations/20261030144000_knowledge_summary_review_invalidation.rollback.sql'),'utf8');
const summaryOnly=fs.readFileSync(path.join(root,'cloudbase/migrations/20261102100000_knowledge_summary_only.sql'),'utf8');
const summaryOnlyDown=fs.readFileSync(path.join(root,'cloudbase/migrations/20261102100000_knowledge_summary_only.rollback.sql'),'utf8');
const directSave=fs.readFileSync(path.join(root,'cloudbase/migrations/20261103160000_knowledge_content_direct_save.sql'),'utf8');
const directSaveDown=fs.readFileSync(path.join(root,'cloudbase/migrations/20261103160000_knowledge_content_direct_save.rollback.sql'),'utf8');

test('generated-content review migration stays additive, public-only, and has a paired rollback',()=>{
  assert.match(up,/ALTER TABLE public\.knowledge_content_commands/);
  assert.match(up,/status IN \('preview','pending_review','rejected','applied','queued','running','done','failed'\)/);
  assert.match(up,/status='pending_review',after_state=nxt/);
  assert.match(up,/p_operation='approve'/);
  assert.match(up,/p_operation='reject'/);
  assert.match(up,/current_at<>c\.expected_updated_at OR old<>c\.before_state/);
  assert.match(up,/SET gpt_original_text=\$1,gpt_summary=\$2/);
  assert.doesNotMatch(up,/\b(?:DROP TABLE|DROP FUNCTION|CASCADE)\b/i);
  assert.doesNotMatch(up,/\bpr\./i);
  assert.match(down,/status='preview'.*WHERE status='pending_review'/s);
  assert.match(down,/CREATE OR REPLACE FUNCTION public\.crm_knowledge_content_v1/);
  assert.match(down,/status IN \('preview','applied','queued','running','done','failed'\)/);
  const integration=fs.readFileSync(path.join(root,'tests/knowledge-library/generated-review.sql'),'utf8');
  assert.match(integration,/SYNTHETIC_ROLLBACK_PASS/);assert.match(integration,/pending_review/);assert.match(integration,/crm_knowledge_content_v1\('approve'/);
  assert.match(targetUp,/payload->>'target'/);assert.match(targetUp,/after_state,payload,expires_at/);
  assert.match(targetDown,/status='pending_review'/);assert.match(targetDown,/CREATE OR REPLACE FUNCTION public\.crm_knowledge_content_v1/);
  assert.match(invalidateUp,/pair->>'summary' IS DISTINCT FROM old#>>'\{original,summary\}'/);
  assert.doesNotMatch(invalidateDown,/pair->>'summary' IS DISTINCT FROM old#>>'\{original,summary\}'/);
});

test('knowledge editor uses direct saving and exposes no review or manual progress UI',()=>{
  const ui=fs.readFileSync(path.join(root,'crm/js/modules/console/knowledge-content.js'),'utf8');
  const governance=fs.readFileSync(path.join(root,'crm/js/modules/console/knowledge-governance.js'),'utf8');
  const i18n=fs.readFileSync(path.join(root,'crm/js/modules/console/i18n.js'),'utf8');
  assert.match(ui,/call\('save'/);assert.match(ui,/kc-edit-grid/);
  assert.doesNotMatch(ui,/call\('(approve|reject|preview|apply|command|retry)'/);
  assert.doesNotMatch(ui,/pending|history|candidate|refresh/i);
  assert.match(governance,/sourceExtractionStatus==='draft'/);assert.match(governance,/knowledgeLibrary\(ctx,'review'/);
  assert.doesNotMatch(governance,/contentReviewPending/);
  for(const key of ['kc_save','kc_system_summary','kc_gpt_summary','kc_regenerate_text','kc_regenerate_summary'])assert.match(i18n,new RegExp(key+'\\s*:'));
  for(const key of ['kc_save_preview','kc_approve','kc_reject','kc_refresh','kc_candidate'])assert.doesNotMatch(i18n,new RegExp(key+'\\s*:'));
});

test('direct-save migration keeps rollback and validates record version while bypassing legacy pending rows',()=>{
  assert.match(directSave,/p_operation NOT IN \('get','save','regenerate'\)/);assert.match(directSave,/Direct save/);
  assert.match(directSave,/expectedUpdatedAt/);assert.match(directSave,/expectedVersion/);
  assert.match(directSave,/expectedSourceFingerprint/);assert.match(directSave,/UPDATE public\.knowledge_items SET content=base_text,metadata=meta,gpt_summary/);
  assert.match(directSave,/UPDATE public\.playbooks SET response_logic=base_text,metadata=meta,gpt_summary/);
  assert.match(directSave,/CONTENT_OPERATION_REMOVED/);assert.match(directSave,/p_operation='get' THEN[\s\S]*?RETURN jsonb_build_object\('ok',true,'record',old\)/);
  const regenerateBranch=directSave.slice(directSave.indexOf("IF p_operation='regenerate' THEN"),directSave.indexOf("IF p_data->>'expectedUpdatedAt'"));
  assert.doesNotMatch(regenerateBranch,/CONTENT_PENDING_EXISTS/);
  assert.match(directSave,/SET status=p_data->>'status',payload=p_data->'payload'/,'worker queue progress remains internal');
  assert.doesNotMatch(directSave,/\b(?:DROP TABLE|DROP FUNCTION|CASCADE)\b/i);assert.doesNotMatch(directSave,/\bpr\./i);
  assert.match(directSaveDown,/CREATE OR REPLACE FUNCTION public\.crm_knowledge_content_v1/);
  assert.doesNotMatch(directSaveDown,/p_operation='save'/);
  const integration=fs.readFileSync(path.join(root,'tests/knowledge-library/direct-save.sql'),'utf8');
  assert.match(integration,/STALE_SAVE_WAS_ACCEPTED/);assert.match(integration,/CLEAR_SYSTEM_PAIR_DID_NOT_APPLY/);
  assert.match(integration,/ROLLBACK/);
});

test('summary-only migration guards data, removes GPT-original fields and narrows OAuth scopes',()=>{
  assert.match(summaryOnly,/KNOWLEDGE_GPT_ORIGINAL_DATA_PRESENT/);
  assert.match(summaryOnly,/SET before_state=before_state#-'\{gpt,text\}',after_state=after_state#-'\{gpt,text\}'/);
  assert.match(summaryOnly,/ALTER TABLE public\.knowledge_items DROP COLUMN gpt_original_text/);
  assert.match(summaryOnly,/ALTER TABLE public\.playbooks DROP COLUMN gpt_original_text/);
  assert.match(summaryOnly,/SET gpt_summary=\$1,selected_content_source=\$2/);
  assert.match(summaryOnly,/dest='gpt' AND k<>'summary'/);
  assert.match(summaryOnly,/pendingReviewExists',has_pending/);
  assert.doesNotMatch(summaryOnly,/record_table=tbl AND record_id=rid AND actor_uid=p_actor_uid AND status='pending_review'\) THEN RAISE EXCEPTION 'CONTENT_PENDING_EXISTS'/);
  assert.match(summaryOnly,/array_remove\(scopes,'knowledge:source:read'\)/);
  assert.match(summaryOnly,/ARRAY\['knowledge:read','knowledge:gpt:submit'\]/);
  assert.ok(summaryOnly.indexOf("array_remove(scopes,'knowledge:source:read')")<summaryOnly.indexOf('ADD CONSTRAINT crm_knowledge_mcp_grants_scopes_check'),'active grants must be narrowed before the new scope constraint is installed');
  assert.match(summaryOnly,/SET before_state=before_state#-'\{gpt,text\}',after_state=after_state#-'\{gpt,text\}'[\s\S]*?status='pending_review'/);
  assert.doesNotMatch(summaryOnly,/\b(?:DROP TABLE|DROP FUNCTION|CASCADE)\b/i);
  assert.doesNotMatch(summaryOnly,/\bpr\./i);
  assert.match(summaryOnlyDown,/ALTER TABLE public\.knowledge_items ADD COLUMN gpt_original_text text/);
  assert.match(summaryOnlyDown,/CREATE OR REPLACE FUNCTION public\.crm_knowledge_content_v1/);
  assert.match(summaryOnlyDown,/ARRAY\['knowledge:read','knowledge:source:read','knowledge:gpt:submit'\]/);
  const service=fs.readFileSync(path.join(root,'cloudfunctions/assistant/knowledge-content-service.js'),'utf8');
  assert.match(service,/record\.original\?\.text/);assert.match(service,/sourceBytes\(source/,'background OCR may still read attachments outside MCP summary generation');
  const mcp=fs.readFileSync(path.join(root,'cloudfunctions/knowledge_mcp/index.js'),'utf8');
  assert.doesNotMatch(mcp,/knowledge:source:read/);assert.doesNotMatch(mcp,/gpt_original_text/);
  assert.match(mcp,/systemOriginalText:record\.original\?\.text/);
});
