'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(root,'cloudbase/migrations/20261018010000_learning_idempotency.sql'),'utf8');
const rollback = fs.readFileSync(path.join(root,'cloudbase/rollbacks/20261018010000_learning_idempotency.sql'),'utf8');

test('PC32-A only replaces the approved public function and preserves permissions and business data', () => {
  for (const sql of [migration,rollback]) {
    assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.crm_ai_experience_learning_v1/g)||[]).length,1);
    assert.doesNotMatch(sql,/\b(?:DROP|DELETE|TRUNCATE|ALTER TABLE|GRANT|REVOKE)\b/i);
    assert.doesNotMatch(sql,/\bpr\.|\bpr_[a-z]/i);
    assert.match(sql,/SET search_path (?:TO|=) 'pg_catalog', 'public'/);
    assert.match(sql,/BEGIN;[\s\S]*COMMIT;/);
  }
  const body=migration.split('$function$')[1];
  const hash=crypto.createHash('md5').update(body.replace(/\r\n/g,'\n')).digest('hex');
  assert.ok(rollback.includes(hash),'rollback refuses an unexpected newer function body');
  assert.match(migration,/35d51ed4e311dcee8764c470e53f93ec/);
});

test('PC32-A serializes before lookup, binds actor and full payload, and writes source audit atomically', () => {
  const lock=migration.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock');
  const lookup=migration.indexOf('SELECT * INTO v_learning');
  assert.ok(lock>0 && lock<lookup);
  assert.match(migration,/candidate_key=p_candidate_key FOR UPDATE/);
  assert.match(migration,/provenance->>'actorUid' IS DISTINCT FROM p_actor_uid/);
  assert.match(migration,/v_previous IS DISTINCT FROM v_request/);
  const normalized=migration.slice(migration.indexOf('v_request :='),lock);
  for (const key of ['sourceResultIds','primaryResultId','situation','recommendation','actualAction','learning','scope','confidence','counterexampleIds'])
    assert.ok(normalized.includes("'"+key+"'"),key);
  assert.equal((migration.match(/INSERT INTO public\.learnings/g)||[]).length,1);
  assert.match(migration,/'requestVersion',1,'requestPayload',v_request/);
  assert.match(migration,/v_sample <> cardinality\(v_result_ids\)/);
  assert.match(migration,/latest\.decision IN \('accepted','modified','rejected'\) AND outs\.ids IS NOT NULL/);
});

test('PC32-A preserves historical reconstruction, replay result fields, and human confirmation', () => {
  assert.match(migration,/Historical Learning source audit is unavailable/);
  for (const field of ['source_id','situation','ai_recommendation','actual_action','learning','scope','confidence','counterexamples'])
    assert.ok(migration.includes('v_learning.'+field),field);
  assert.match(migration,/'learningId',v_learning\.id,'sampleSize',v_learning\.sample_size,'replayed',true/);
  assert.match(migration,/'confirmed',false,'replayed',false/);
  assert.doesNotMatch(migration,/UPDATE public\.learnings|confirmed\s*=\s*true/);
});
