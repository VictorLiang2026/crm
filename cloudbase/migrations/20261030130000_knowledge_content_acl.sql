BEGIN;
SET LOCAL lock_timeout='3s';
-- Override inherited default privileges on this new history table only.
REVOKE ALL ON public.knowledge_content_commands FROM service_role;
GRANT SELECT,INSERT,UPDATE ON public.knowledge_content_commands TO service_role;
COMMIT;
