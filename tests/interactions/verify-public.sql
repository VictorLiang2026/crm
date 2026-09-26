-- Read-only post-migration check. Run only against public; returns no customer data.
SELECT count(*)::bigint AS ledger_rows FROM public.interactions;

SELECT c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.relacl::text AS table_acl
FROM pg_class AS c
WHERE c.oid = 'public.interactions'::regclass;

SELECT has_table_privilege('anon', 'public.interactions', 'SELECT') AS anon_can_read,
       has_table_privilege('authenticated', 'public.interactions', 'SELECT') AS authenticated_can_read,
       has_table_privilege('service_role', 'public.interactions', 'SELECT') AS service_can_read;
