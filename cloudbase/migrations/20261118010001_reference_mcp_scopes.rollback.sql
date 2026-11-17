BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_knowledge_mcp_grants WHERE scopes && ARRAY['references:read','references:gpt:submit']::text[]) THEN
  RAISE EXCEPTION 'Reference scopes are granted; assess or replace grants before rollback';
 END IF;
END $guard$;
ALTER TABLE public.crm_knowledge_mcp_grants DROP CONSTRAINT crm_knowledge_mcp_grants_scopes_check;
ALTER TABLE public.crm_knowledge_mcp_grants ADD CONSTRAINT crm_knowledge_mcp_grants_scopes_check CHECK (
 scopes <@ ARRAY['knowledge:read','knowledge:gpt:submit','followup:read','followup:gpt:submit','followup:gpt:direct_write']::text[]
 AND (NOT scopes @> ARRAY['followup:gpt:submit']::text[] OR scopes @> ARRAY['followup:read']::text[])
 AND (NOT scopes @> ARRAY['followup:gpt:direct_write']::text[] OR scopes @> ARRAY['followup:read']::text[])
);
COMMIT;
