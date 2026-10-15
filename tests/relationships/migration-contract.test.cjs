'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.join(__dirname,'../../cloudbase/migrations/20261015190000_relationship_lifecycle');
const up=fs.readFileSync(`${base}.sql`,'utf8');
const down=fs.readFileSync(`${base}.rollback.sql`,'utf8');
test('PC09 migrations use public only and enforce service-only audited commands',()=>{
 assert.match(up,/ALTER TABLE public\.relationships ADD COLUMN importance smallint/);
 assert.match(up,/importance BETWEEN 1 AND 5/);
 assert.match(up,/CREATE TABLE public\.crm_relationship_commands/);
 assert.match(up,/ENABLE ROW LEVEL SECURITY/);
 assert.match(up,/FORCE ROW LEVEL SECURITY/);
 assert.match(up,/current_user<>'service_role'/);
 assert.match(up,/status='confirmed'/);
 assert.match(up,/deleted_at=v_now/);
 assert.doesNotMatch(up,/\b(?:pr|pr_[a-z0-9_]+)\s*\./i);
});
test('rollback preserves executed relationship history and importance values',()=>{
 assert.match(down,/status='executed'/);
 assert.match(down,/importance IS NOT NULL/);
 assert.match(down,/rollback blocked/);
 assert.match(down,/DROP TABLE public\.crm_relationship_commands/);
});
