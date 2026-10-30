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
