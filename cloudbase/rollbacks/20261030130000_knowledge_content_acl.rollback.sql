-- Keep the restrictive ACL on rollback; stop new operations, preserve history.
BEGIN;
REVOKE INSERT,UPDATE ON public.knowledge_content_commands FROM service_role;
COMMIT;
