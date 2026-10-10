-- Check all view definitions and function bodies for references to dropped columns/objects
SELECT n.nspname AS schema, c.relname AS view_name,
       CASE
         WHEN pg_get_viewdef(c.oid, true) ~* 'legacy_customer_id|customer_person_identity_bridge|recruit_candidate_person_sync' THEN 'BAD'
         WHEN pg_get_viewdef(c.oid, true) ~* 'c\.(customer_name|wx_account)\b' THEN 'BAD_OLD_ALIAS'
         ELSE 'OK'
       END AS status,
       left(pg_get_viewdef(c.oid, true), 200) AS def_head
FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
WHERE n.nspname='public' AND c.relkind='v'
  AND c.relname IN ('customers_view','followups_view','gifts_view','photos_view','products_view','ai_recommendations_view',
                    'v_action_center','v_recruit_candidates','v_recruit_candidates_person_only',
                    'v_recruit_candidates_person_only_trash','v_recruit_candidates_trash')
ORDER BY c.relname;
