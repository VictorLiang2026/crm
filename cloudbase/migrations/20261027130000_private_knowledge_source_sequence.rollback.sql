-- Restore the audited pre-migration sequence privileges.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.knowledge_sources_id_seq') IS NULL THEN
    RAISE EXCEPTION 'Expected public.knowledge_sources_id_seq to exist';
  END IF;
END
$$;

REVOKE ALL ON SEQUENCE public.knowledge_sources_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.knowledge_sources_id_seq TO anon, authenticated, service_role;

COMMIT;
