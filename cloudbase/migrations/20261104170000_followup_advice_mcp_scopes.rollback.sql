BEGIN;
SET LOCAL lock_timeout='3s';

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.crm_knowledge_mcp_grants
    WHERE scopes && ARRAY['followup:read','followup:gpt:submit']::text[]
  ) THEN
    RAISE EXCEPTION 'Follow-up MCP scopes are granted; revoke or replace grants before rollback';
  END IF;
END;
$rollback$;

ALTER TABLE public.crm_knowledge_mcp_grants
  DROP CONSTRAINT crm_knowledge_mcp_grants_scopes_check;

ALTER TABLE public.crm_knowledge_mcp_grants
  ADD CONSTRAINT crm_knowledge_mcp_grants_scopes_check
  CHECK (scopes <@ ARRAY['knowledge:read','knowledge:gpt:submit']::text[]);

COMMIT;
