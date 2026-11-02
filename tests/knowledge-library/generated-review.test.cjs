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

test('bilingual knowledge UI exposes a separate pending approval step',()=>{
  const ui=fs.readFileSync(path.join(root,'crm/js/modules/console/knowledge-content.js'),'utf8');
  const governance=fs.readFileSync(path.join(root,'crm/js/modules/console/knowledge-governance.js'),'utf8');
  const i18n=fs.readFileSync(path.join(root,'crm/js/modules/console/i18n.js'),'utf8');
  assert.match(ui,/call\('approve'/);assert.match(ui,/call\('reject'/);assert.match(ui,/pending\.after/);
  assert.match(governance,/sourceExtractionStatus==='draft'/);assert.match(governance,/knowledgeLibrary\(ctx,'review'/);
  for(const key of ['kc_pending_title','kc_pending_note','kc_approve','kc_reject','kg_status_pending_review','kg_review_activate']){
    assert.match(i18n,new RegExp(`['"]?${key}['"]?\\s*:`));
  }
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
