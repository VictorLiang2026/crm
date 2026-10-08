-- PMC-10: grant anon read access to public.persons (display name authority for action center / today / reports / tasks)
-- Root cause: the rdb() gateway uses the anon role; persons had GRANT/RLS only for service_role,
-- so any direct persons read from cloud functions failed with "permission denied for table persons"
-- (PMC-10 browser acceptance finding, 2026-10-08, user-approved fix plan A).
-- Scope: SELECT only, non-deleted rows only, anon only. No write privileges granted.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'persons' AND policyname = 'persons_anon_read') THEN
    RAISE EXCEPTION 'policy public.persons.persons_anon_read already exists; inspect before re-applying';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'persons' AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'public.persons RLS is not enabled; refusing to grant';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'persons'
             AND 'anon' = ANY (roles) AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'anon already has a non-SELECT policy on public.persons; inspect before re-applying';
  END IF;
END $guard$;

GRANT SELECT ON public.persons TO anon;

CREATE POLICY persons_anon_read ON public.persons
  FOR SELECT TO anon
  USING (deleted_at IS NULL);

COMMIT;
