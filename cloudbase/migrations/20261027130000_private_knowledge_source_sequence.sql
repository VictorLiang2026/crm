-- Restrict the private knowledge-source identifier sequence to the service role.
-- The sequence is part of the service-only source registry; clients must not
-- inspect or advance it directly.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.knowledge_sources_id_seq') IS NULL THEN
    RAISE EXCEPTION 'Expected public.knowledge_sources_id_seq to exist';
  END IF;
END
$$;

REVOKE ALL ON SEQUENCE public.knowledge_sources_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.knowledge_sources_id_seq TO service_role;

COMMIT;
