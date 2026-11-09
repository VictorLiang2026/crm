BEGIN;
SET LOCAL lock_timeout='4s';
DO $guard$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='persons' AND policyname='persons_anon_read') THEN RAISE EXCEPTION 'Refuse to remove the active server read path'; END IF;
END $guard$;
DROP POLICY persons_fn_read ON public.persons;
COMMIT;
