SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) OPERATOR(pg_catalog.~*) 'legacy_customer_id'
ORDER BY p.proname;
