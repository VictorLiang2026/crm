-- Restores PMC-10's known public exposure. Never use for an automatic rollback.
-- An authorized operator must SET crm_security.allow_exposure_rollback='yes' in this session first.
BEGIN;
SET LOCAL lock_timeout='4s';
DO $guard$ BEGIN
 IF current_setting('crm_security.allow_exposure_rollback',true) IS DISTINCT FROM 'yes' THEN
 RAISE EXCEPTION 'Restoring anonymous Person reads requires explicit incident approval'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='persons' AND policyname='persons_fn_read') THEN RAISE EXCEPTION 'Server read policy missing'; END IF;
END $guard$;
CREATE POLICY persons_anon_read ON public.persons FOR SELECT TO anon USING (deleted_at IS NULL);
COMMIT;
