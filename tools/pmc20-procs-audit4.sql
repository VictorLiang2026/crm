SELECT p.proname, length(pg_get_functiondef(p.oid)) AS deflen
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
WHERE n.nspname='public'
ORDER BY p.proname;
