-- Restore compatible frontend/functions first. Preserve generated text/history and all existing objects.
BEGIN;
SET LOCAL lock_timeout='3s';
REVOKE EXECUTE ON FUNCTION public.crm_knowledge_content_v1(text,text,jsonb) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.crm_knowledge_content_snapshot_v1(text,bigint) FROM service_role;
REVOKE INSERT,UPDATE ON public.knowledge_content_commands FROM service_role;
-- No deletion of fields, originals, commands or history. This disables the new workflow only.
COMMIT;
