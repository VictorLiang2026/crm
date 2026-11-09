-- Run only after verifying real server reads and dependent clients. No ACL,
-- view or service_role changes; security-invoker views need the underlying ACL.
BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.persons'::regclass AND relrowsecurity)
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='persons' AND policyname='persons_fn_read'
   AND roles=ARRAY['anon']::name[] AND cmd='SELECT' AND md5(qual)='d073e125f79b02a09034b64e12c45886')
 OR (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='persons') <> 3
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='persons' AND policyname='persons_anon_read'
   AND roles=ARRAY['anon']::name[] AND cmd='SELECT' AND qual='(deleted_at IS NULL)')
 THEN RAISE EXCEPTION 'Server policy absent or baseline drifted'; END IF;
END $guard$;
DROP POLICY persons_anon_read ON public.persons;
COMMIT;
