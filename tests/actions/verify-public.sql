-- Read-only production verification. No test fixtures are created.
SELECT count(*)::bigint AS action_rows FROM public.actions;
SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class WHERE oid = 'public.actions'::regclass;
SELECT count(*)::integer AS foreign_key_count FROM pg_constraint
WHERE conrelid = 'public.actions'::regclass AND contype = 'f';
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'actions'
ORDER BY grantee, privilege_type;
