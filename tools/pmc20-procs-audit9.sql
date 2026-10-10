SELECT p.proname, pg_get_functiondef(p.oid) AS def
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
WHERE n.nspname='public' AND p.proname = 'crm_customers_page_v1';
