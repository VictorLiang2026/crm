-- Read-only production verification; every business object is in public.
SELECT
  (SELECT count(*) FROM public.context_items) AS context_item_count,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'context_items') AS column_count,
  (SELECT count(*) FROM pg_constraint
   WHERE conrelid = 'public.context_items'::regclass AND contype = 'f') AS foreign_key_count,
  (SELECT count(*) FROM pg_trigger
   WHERE tgrelid = 'public.context_items'::regclass
     AND tgname = 'context_items_validate_before_write' AND NOT tgisinternal) AS guard_trigger_count,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.context_items'::regclass) AS rls_enabled,
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.context_items'::regclass) AS rls_forced,
  (SELECT coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '')
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'context_items'
     AND grantee = 'anon') AS anon_privileges,
  (SELECT coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '')
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'context_items'
     AND grantee = 'authenticated') AS authenticated_privileges,
  (SELECT coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '')
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'context_items'
     AND grantee = 'service_role') AS service_privileges;
