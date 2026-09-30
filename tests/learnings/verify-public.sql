-- Read-only checks; all business objects are explicitly limited to public.
SELECT count(*) AS learning_rows FROM public.learnings;

SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'learnings'
ORDER BY ordinal_position;

SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       c.relacl::text AS table_acl
FROM pg_class AS c WHERE c.oid = 'public.learnings'::regclass;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'learnings'
ORDER BY grantee, privilege_type;

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'learnings'
ORDER BY policyname;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.learnings'::regclass
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'learnings'
ORDER BY indexname;
