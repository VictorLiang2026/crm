'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('reference scope migration preserves earlier grants and cannot roll back across new grants',async()=>{
 const db=new PGlite(),read=s=>fs.readFileSync('cloudbase/migrations/'+s,'utf8');try{
  await db.exec("CREATE TABLE public.crm_knowledge_mcp_grants(scopes text[],CONSTRAINT crm_knowledge_mcp_grants_scopes_check CHECK(scopes <@ ARRAY['knowledge:read']));INSERT INTO public.crm_knowledge_mcp_grants VALUES(ARRAY['knowledge:read']);");
  await db.exec(read('20261118010001_reference_mcp_scopes.sql'));
  await db.exec("INSERT INTO public.crm_knowledge_mcp_grants VALUES(ARRAY['followup:read','followup:gpt:direct_write']), (ARRAY['references:read','references:gpt:submit']);");
  await assert.rejects(db.exec("INSERT INTO public.crm_knowledge_mcp_grants VALUES(ARRAY['knowledge:read','references:gpt:submit']);"),/check constraint/);
  await assert.rejects(db.exec(read('20261118010001_reference_mcp_scopes.rollback.sql')),/Reference scopes are granted/);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*) n FROM public.crm_knowledge_mcp_grants')).rows[0].n,3);
 }finally{await db.close();}
});
