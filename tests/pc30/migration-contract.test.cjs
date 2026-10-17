'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const migration=fs.readFileSync(path.join(root,'cloudbase/migrations/20261017232000_proactive_coach.sql'),'utf8');
const rollback=fs.readFileSync(path.join(root,'cloudbase/rollbacks/20261017232000_proactive_coach.sql'),'utf8');

test('PC30 migration is additive, public-scoped, and limits decision access to service_role',()=>{
  assert.match(migration,/CREATE TABLE public\.crm_proactive_coach_decisions/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/FORCE ROW LEVEL SECURITY/);
  assert.match(migration,/CREATE POLICY crm_proactive_coach_service_only[\s\S]*TO service_role/);
  assert.match(migration,/REVOKE ALL ON TABLE public\.crm_proactive_coach_decisions FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration,/GRANT SELECT, INSERT, UPDATE ON TABLE public\.crm_proactive_coach_decisions TO service_role/);
  assert.match(migration,/REVOKE ALL ON FUNCTION public\.crm_proactive_coach_decision_v1[\s\S]*FROM PUBLIC,anon,authenticated/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.crm_proactive_coach_decision_v1[\s\S]*TO service_role/);
  assert.doesNotMatch(migration,/\b(?:pr|pr_[a-z0-9_]+)\s*\./i);
  assert.doesNotMatch(migration,/\b(?:DROP|TRUNCATE)\s+(?:TABLE|FUNCTION)\b/i);
});

test('PC30 rollback refuses to discard operator decisions before dropping only its own objects',()=>{
  assert.match(rollback,/IF EXISTS \(SELECT 1 FROM public\.crm_proactive_coach_decisions\)/);
  assert.match(rollback,/DROP FUNCTION public\.crm_proactive_coach_decision_v1/);
  assert.match(rollback,/DROP TABLE public\.crm_proactive_coach_decisions/);
  assert.doesNotMatch(rollback,/\b(?:pr|pr_[a-z0-9_]+)\s*\./i);
});
