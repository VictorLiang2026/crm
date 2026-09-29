-- Read-only checks for the knowledge catalog; all application objects are public-qualified.
SELECT count(*) AS knowledge_rows FROM public.knowledge_items;

SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class AS c WHERE c.oid = 'public.knowledge_items'::regclass;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'knowledge_items'
ORDER BY grantee, privilege_type;

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'knowledge_items'
ORDER BY policyname;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.knowledge_items'::regclass
ORDER BY conname;
