'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'../..');
const migration=fs.readFileSync(path.join(root,'cloudbase/migrations/20261101210900_knowledge_mcp_codex_loopback.sql'),'utf8');
const rollback=fs.readFileSync(path.join(root,'cloudbase/migrations/20261101210900_knowledge_mcp_codex_loopback.rollback.sql'),'utf8');

test('Codex loopback migration keeps OAuth data and helpers inside public with service-only helper access',()=>{
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.crm_knowledge_mcp_redirect_uri_allowed_v1/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.crm_knowledge_mcp_redirect_uri_matches_v1/);
  assert.match(migration,/REVOKE ALL ON FUNCTION public\.crm_knowledge_mcp_redirect_uri_allowed_v1\(text\) FROM PUBLIC,anon,authenticated/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.crm_knowledge_mcp_redirect_uri_matches_v1\(text,text\) TO service_role/);
  assert.doesNotMatch(migration,/\b(?:pr|pr_[a-z0-9_]+)\s*\./i);
  assert.match(migration,/ALTER TABLE public\.crm_knowledge_mcp_clients ADD CONSTRAINT[\s\S]*?CHECK \(public\.crm_knowledge_mcp_redirect_uri_allowed_v1\(redirect_uri\)\)/);
});

test('Codex loopback port flexibility is restricted to the exact loopback callback in registration and grant issuance',()=>{
  assert.ok(migration.includes(String.raw`p_uri !~ '^http://127\.0\.0\.1(:[1-9][0-9]{0,4})?/callback$'`));
  assert.match(migration,/port_text::integer<=65535/);
  assert.match(migration,/crm_knowledge_mcp_redirect_uri_matches_v1\(redirect_uri,p_data->>'redirectUri'\)/);
  assert.match(migration,/r\.redirect_uri<>p_data->>'redirectUri'/);
  assert.match(rollback,/DROP FUNCTION public\.crm_knowledge_mcp_redirect_uri_matches_v1\(text,text\)/);
  assert.match(rollback,/DROP FUNCTION public\.crm_knowledge_mcp_redirect_uri_allowed_v1\(text\)/);
  assert.match(rollback,/redirect_uri='https:\/\/chatgpt\.com\/connector_platform_oauth_redirect'/);
});
