-- Read-only validation. All business references remain in public.
SELECT count(*) AS outcome_rows FROM public.outcomes;

SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'outcomes'
ORDER BY ordinal_position;

SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       c.relacl::text AS table_acl
FROM pg_class AS c WHERE c.oid = 'public.outcomes'::regclass;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'outcomes'
ORDER BY grantee, privilege_type;

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'outcomes'
ORDER BY policyname;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.outcomes'::regclass
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'outcomes'
ORDER BY indexname;
