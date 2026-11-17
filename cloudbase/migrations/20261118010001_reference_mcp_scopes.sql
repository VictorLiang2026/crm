BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.crm_knowledge_mcp_grants DROP CONSTRAINT crm_knowledge_mcp_grants_scopes_check;
ALTER TABLE public.crm_knowledge_mcp_grants ADD CONSTRAINT crm_knowledge_mcp_grants_scopes_check CHECK (
 scopes <@ ARRAY['knowledge:read','knowledge:gpt:submit','followup:read','followup:gpt:submit','followup:gpt:direct_write','references:read','references:gpt:submit']::text[]
 AND (NOT scopes @> ARRAY['followup:gpt:submit']::text[] OR scopes @> ARRAY['followup:read']::text[])
 AND (NOT scopes @> ARRAY['followup:gpt:direct_write']::text[] OR scopes @> ARRAY['followup:read']::text[])
 AND (NOT scopes @> ARRAY['references:gpt:submit']::text[] OR scopes @> ARRAY['references:read']::text[])
);
COMMIT;
