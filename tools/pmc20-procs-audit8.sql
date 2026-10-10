SELECT x.proname,
       (strpos(x.def, 'legacy_customer_id') > 0) AS hit_legacy_customer_id,
       (strpos(x.def, 'wx_account') > 0) AS hit_wx_account,
       (x.def ~* '[a-z_][a-z0-9_]*\.customer_name') AS hit_alias_customer_name,
       (x.def ~* '[a-z_][a-z0-9_]*\.(gender|birthday|occupation|education|phone)') AS hit_alias_basic,
       (x.def ~* 'customer_person_identity_bridge|recruit_candidate_person_sync') AS hit_old_dropped_fn
FROM (
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
) x
WHERE strpos(x.def, 'legacy_customer_id') > 0
   OR strpos(x.def, 'wx_account') > 0
   OR x.def ~* '[a-z_][a-z0-9_]*\.customer_name'
   OR x.def ~* '[a-z_][a-z0-9_]*\.(gender|birthday|occupation|education|phone)'
   OR x.def ~* 'customer_person_identity_bridge|recruit_candidate_person_sync'
ORDER BY x.proname;
