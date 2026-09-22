-- Read-only metadata to design explicitly marked test records before any insertion.
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('policy_review_reports', 'customers', 'v_recruit_candidates',
                      'v_recruit_candidates_trash', 'v_action_center', 'v_funnel_stats')
ORDER BY c.table_name, c.ordinal_position;
