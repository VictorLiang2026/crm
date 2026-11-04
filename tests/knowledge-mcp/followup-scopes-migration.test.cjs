'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'../../cloudbase/migrations');
const up=fs.readFileSync(path.join(root,'20261104170000_followup_advice_mcp_scopes.sql'),'utf8');
const down=fs.readFileSync(path.join(root,'20261104170000_followup_advice_mcp_scopes.rollback.sql'),'utf8');
const directUp=fs.readFileSync(path.join(root,'20261104180000_followup_gpt_direct_write_scope.sql'),'utf8');
const directDown=fs.readFileSync(path.join(root,'20261104180000_followup_gpt_direct_write_scope.rollback.sql'),'utf8');

test('follow-up OAuth scope migration is public-only and pairs write permission with follow-up read',()=>{
  assert.match(up,/ALTER TABLE public\.crm_knowledge_mcp_grants/);
  assert.match(up,/followup:read/);
  assert.match(up,/followup:gpt:submit/);
  assert.match(up,/NOT scopes @> ARRAY\['followup:gpt:submit'\]::text\[\] OR scopes @> ARRAY\['followup:read'\]/);
  assert.doesNotMatch(up,/\bpr\./i);
  assert.doesNotMatch(up,/\b(?:DROP TABLE|DROP FUNCTION|CASCADE)\b/i);
});

test('direct-write scope is separately granted and requires follow-up read',()=>{
  assert.match(directUp,/ALTER TABLE public\.crm_knowledge_mcp_grants/);
  assert.match(directUp,/followup:gpt:direct_write/);
  assert.match(directUp,/NOT scopes @> ARRAY\['followup:gpt:direct_write'\]::text\[\] OR scopes @> ARRAY\['followup:read'\]/);
  assert.doesNotMatch(directUp,/\bpr\./i);
  assert.doesNotMatch(directUp,/\b(?:DROP TABLE|DROP FUNCTION|CASCADE)\b/i);
});

test('direct-write scope rollback refuses to remove active grants',()=>{
  assert.match(directDown,/FROM public\.crm_knowledge_mcp_grants[\s\S]*scopes @> ARRAY\['followup:gpt:direct_write'\]/);
  assert.match(directDown,/revoke or replace grants before rollback/);
  assert.match(directDown,/ARRAY\['knowledge:read','knowledge:gpt:submit','followup:read','followup:gpt:submit'\]/);
  assert.doesNotMatch(directDown,/\bpr\./i);
  assert.doesNotMatch(directDown,/\b(?:DROP TABLE|DROP FUNCTION|CASCADE)\b/i);
});

test('scope rollback refuses to remove permissions that are still granted',()=>{
  assert.match(down,/FROM public\.crm_knowledge_mcp_grants[\s\S]*scopes && ARRAY\['followup:read','followup:gpt:submit'\]/);
  assert.match(down,/RAISE EXCEPTION 'Follow-up MCP scopes are granted/);
  assert.match(down,/ARRAY\['knowledge:read','knowledge:gpt:submit'\]/);
  assert.doesNotMatch(down,/\bpr\./i);
  assert.doesNotMatch(down,/\b(?:DROP TABLE|DROP FUNCTION|CASCADE)\b/i);
});
