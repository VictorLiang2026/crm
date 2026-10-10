-- PMC-20: scan ALL public function bodies for references to dropped customers/persons/recruit columns.
-- New filename (pmc20-procs-audit2) to bypass any stale-file/cache issue seen earlier.
-- Qualified alias hits (x.col) are listed per token; raw definitions reviewed manually because
-- child-table snapshot columns legitimately share the name customer_name.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       (pg_get_functiondef(p.oid) ~* 'legacy_customer_id') AS hit_legacy_customer_id,
       (pg_get_functiondef(p.oid) ~* 'wx_account') AS hit_wx_account,
       (pg_get_functiondef(p.oid) ~ '[A-Za-z_][A-Za-z0-9_]*\.customer_name') AS hit_alias_customer_name,
       (pg_get_functiondef(p.oid) ~ '[A-Za-z_][A-Za-z0-9_]*\.(gender|birthday|occupation|education|phone)') AS hit_alias_basic_cols,
       (pg_get_functiondef(p.oid) ~* 'customer_person_identity_bridge|recruit_candidate_person_sync') AS hit_old_dropped_fn
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND (
    pg_get_functiondef(p.oid) ~* 'legacy_customer_id'
    OR pg_get_functiondef(p.oid) ~* 'wx_account'
    OR pg_get_functiondef(p.oid) ~ '[A-Za-z_][A-Za-z0-9_]*\.customer_name'
    OR pg_get_functiondef(p.oid) ~ '[A-Za-z_][A-Za-z0-9_]*\.(gender|birthday|occupation|education|phone)'
    OR pg_get_functiondef(p.oid) ~* 'customer_person_identity_bridge|recruit_candidate_person_sync'
  )
ORDER BY p.proname, args;
