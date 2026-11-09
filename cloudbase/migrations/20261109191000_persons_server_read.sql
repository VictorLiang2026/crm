-- Phase 1, additive only. Cloud functions use a signed anon role JWT without a
-- subject; published keys and end-user sessions have a subject. Reuse the same
-- boundary as customers_fn_only. Phase 2 is separate and requires live canaries.
BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.persons'::regclass AND relrowsecurity)
    OR NOT pg_catalog.has_table_privilege('anon','public.persons','SELECT')
    OR (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='persons') <> 2
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='persons'
      AND policyname='persons_anon_read' AND roles=ARRAY['anon']::name[] AND cmd='SELECT' AND qual='(deleted_at IS NULL)')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='persons'
      AND policyname='persons_service_only' AND roles=ARRAY['service_role']::name[] AND cmd='ALL' AND qual='true')
    THEN RAISE EXCEPTION 'Unknown public.persons baseline'; END IF;
END $guard$;
CREATE POLICY persons_fn_read ON public.persons FOR SELECT TO anon USING (
  deleted_at IS NULL AND
  (NULLIF(current_setting('request.jwt.claims',true),'')::jsonb ->> 'role') = 'anon' AND
  NOT (NULLIF(current_setting('request.jwt.claims',true),'')::jsonb ? 'sub')
);
COMMIT;
