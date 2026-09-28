-- Manual rollback only: restores the broader pre-fix service_role grants.
-- Requires separate review before execution because it restores DELETE/TRUNCATE.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE ALL ON TABLE public.actions FROM service_role;
GRANT ALL ON TABLE public.actions TO service_role;
REVOKE ALL ON SEQUENCE public.actions_id_seq FROM service_role;
GRANT ALL ON SEQUENCE public.actions_id_seq TO service_role;
COMMIT;
