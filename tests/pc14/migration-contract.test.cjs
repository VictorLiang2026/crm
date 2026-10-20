'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('PC14 migration is public-only, paired with rollback, and limits apply/undo to reviewed fields', () => {
  const sql = read('cloudbase/migrations/20261016110000_ocr_parse_review.sql');
  const rollback = read('cloudbase/migrations/20261016110000_ocr_parse_review.rollback.sql');
  assert.match(sql, /CREATE TABLE public\.crm_ocr_parse_commands/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY[\s\S]*FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /TO service_role USING \(true\) WITH CHECK \(true\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.crm_ocr_parse_execute_v1[^;]+FROM PUBLIC,anon,authenticated/);
  const whitelist = sql.match(/NOT IN\s*\(([\s\S]*?)\) OR\s+EXISTS/);
  assert.ok(whitelist);
  assert.doesNotMatch(whitelist[1], /customer_name|recruitment_priority|deleted_at/);
  assert.match(sql, /before_state/);
  assert.match(sql, /IS DISTINCT FROM v_command\.before_state/);
  assert.match(sql, /IS DISTINCT FROM v_parent\.after_state/);
  assert.match(sql, /actor_uid=p_actor_uid/);
  assert.match(sql, /businessDataWritten',false/);
  assert.match(rollback, /EXISTS \(SELECT 1 FROM public\.crm_ocr_parse_commands\)/);
  assert.match(rollback, /RAISE EXCEPTION 'PC14 OCR review command history exists/);
  assert.doesNotMatch(sql + rollback, /\bpr\./i);
});

test('PC14 keeps existing OCR parse, customer OCR, Quick Capture, and Person tabs wired without replacing their routes', () => {
  const person = read('crm/js/modules/console/pages/person.js');
  const data = read('crm/js/modules/console/data.js');
  const functionSource = read('cloudfunctions/person_360/index.js');
  const legacyParse = read('cloudfunctions/ai_parse/index.js');
  const legacyOcr = read('cloudfunctions/ocr_records/index.js');
  const ocrUi = read('crm/js/modules/console/ocr-review.js');
  const i18n = read('crm/js/modules/console/i18n.js');
  assert.match(person, /renderOcrReview/);
  assert.match(person, /tab_ocr_review/);
  assert.match(data, /parseOcr: \(ctx, input\) => call\(ctx, 'ai_parse'/);
  assert.match(functionSource, /case 'previewOcrParse'/);
  assert.match(functionSource, /case 'previewOcrUndo'/);
  assert.match(legacyParse, /const action = \(event && event\.action\) \|\| 'parse'/);
  assert.match(legacyOcr, /case 'list'/);
  assert.doesNotMatch(legacyParse, /crm_ocr_parse_execute_v1/);
  assert.doesNotMatch(legacyOcr, /crm_ocr_parse_execute_v1/);
  for (const key of new Set(ocrUi.match(/ocr_[a-z_]+/g) || [])) {
    assert.match(i18n, new RegExp(`'${key}':`), `missing bilingual key ${key}`);
  }
});

test('PC14 row-version guards detect changes that are later reverted to the parsed value', () => {
  const up = read('cloudbase/migrations/20261016111500_ocr_parse_row_versions.sql');
  const down = read('cloudbase/migrations/20261016111500_ocr_parse_row_versions.rollback.sql');
  assert.match(up, /rowVersionsBefore/);
  assert.match(up, /rowVersionsAfter/);
  assert.match(up, /profile version changed after parsing/);
  assert.match(up, /profile version changed after preview/);
  assert.match(down, /IF EXISTS \(SELECT 1 FROM public\.crm_ocr_parse_commands\)/);
  assert.match(down, /CREATE FUNCTION public\.crm_ocr_parse_preview_v1/);
  assert.match(down, /CREATE FUNCTION public\.crm_ocr_parse_undo_preview_v1/);
  assert.match(down, /CREATE FUNCTION public\.crm_ocr_parse_execute_v1/);
  assert.match(down, /REVOKE ALL ON FUNCTION public\.crm_ocr_parse_execute_v1/);
  assert.match(down, /GRANT EXECUTE ON FUNCTION public\.crm_ocr_parse_execute_v1[^;]+TO service_role/);
});

test('PC36 OCR undo conflicts return a fixed receipt before a preview row is created and can roll back', () => {
  const up = read('cloudbase/migrations/20261020083300_ocr_undo_conflict_receipt.sql');
  const down = read('cloudbase/rollbacks/20261020083300_ocr_undo_conflict_receipt.rollback.sql');
  assert.match(up, /CREATE OR REPLACE FUNCTION public\.crm_ocr_parse_undo_preview_v1/);
  assert.equal((up.match(/RETURN jsonb_build_object\('errorCode','OCR_UNDO_CONFLICT','businessDataWritten',false\)/g) || []).length, 2);
  assert.ok(up.lastIndexOf("'OCR_UNDO_CONFLICT'") < up.indexOf('INSERT INTO public.crm_ocr_parse_commands'));
  assert.match(down, /OCR undo conflict: one or more fields changed after parsing/);
  assert.match(down, /OCR undo conflict: profile version changed after parsing/);
  assert.doesNotMatch(up + down, /\bpr\./i);
});
