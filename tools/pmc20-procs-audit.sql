-- Scan ALL public function bodies for references to dropped columns/objects
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
WHERE n.nspname='public'
  AND (
    pg_get_functiondef(p.oid) ~* 'legacy_customer_id'
    OR pg_get_functiondef(p.oid) ~* 'customer_person_identity_bridge'
    OR pg_get_functiondef(p.oid) ~* 'recruit_candidate_person_sync'
    OR pg_get_functiondef(p.oid) ~* 'c\.customer_name'
    OR pg_get_functiondef(p.oid) ~* 'c\.wx_account'
  )
ORDER BY p.proname;
