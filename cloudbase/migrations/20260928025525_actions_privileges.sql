-- CloudBase's default service_role table grant is broader than this ledger needs.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF to_regclass('public.actions') IS NULL THEN
    RAISE EXCEPTION 'public.actions is missing';
  END IF;
END $guard$;
REVOKE ALL ON TABLE public.actions FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.actions TO service_role;
REVOKE ALL ON SEQUENCE public.actions_id_seq FROM service_role;
GRANT USAGE, SELECT ON SEQUENCE public.actions_id_seq TO service_role;
COMMIT;
