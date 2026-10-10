SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND strpos(pg_get_functiondef(p.oid), 'legacy_customer_id') > 0
ORDER BY p.proname;
