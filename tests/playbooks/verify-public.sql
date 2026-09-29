-- Read-only checks for the Playbook catalog.
SELECT count(*) AS playbook_rows FROM public.playbooks;

SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       c.relacl::text AS table_acl
FROM pg_class AS c WHERE c.oid = 'public.playbooks'::regclass;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'playbooks'
ORDER BY grantee, privilege_type;

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'playbooks'
ORDER BY policyname;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.playbooks'::regclass
ORDER BY conname;
