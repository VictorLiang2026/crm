BEGIN;
SET LOCAL lock_timeout='3s';
DROP FUNCTION IF EXISTS public.crm_knowledge_mcp_oauth_v1(text,jsonb);
DROP FUNCTION IF EXISTS public.crm_knowledge_gpt_queue_v1(text,text,bigint,timestamptz);
DROP TABLE IF EXISTS public.crm_knowledge_mcp_grants;
DROP TABLE IF EXISTS public.crm_knowledge_mcp_clients;
COMMIT;
