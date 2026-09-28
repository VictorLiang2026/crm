-- Read-only verification; does not expose customer content.
SELECT count(*)::bigint AS commitment_count FROM public.commitments;
SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class WHERE oid = 'public.commitments'::regclass;
SELECT count(*)::integer AS foreign_key_count FROM pg_constraint
WHERE conrelid = 'public.commitments'::regclass AND contype = 'f';
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'commitments'
ORDER BY grantee, privilege_type;
