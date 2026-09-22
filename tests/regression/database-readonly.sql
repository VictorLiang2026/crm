-- Run ONLY with queryPgDatabase(action='sql') after auth(status) confirms
-- env crm-d1gkae8ddc930d151. Never run a migration command for this file.
-- Metadata only; no customer rows, remote business functions, writes or other schemas.
WITH expected(table_name, column_name) AS (VALUES
  ('customers','Id'), ('customers','customer_name'), ('customers','deleted_at'),
  ('followups','customer_id'), ('followups','followup_notes'), ('followups','deleted_at'),
  ('opportunities','customer_id'), ('opportunities','status'), ('opportunities','deleted_at'),
  ('activities','id'), ('activities','name'), ('activities','deleted_at'),
  ('activity_participants','activity_id'), ('activity_participants','person_name'),
  ('recruit_candidates','customer_id'), ('recruit_candidates','deleted_at'),
  ('recruit_followups','candidate_id'), ('recruit_followups','deleted_at'),
  ('v_recruit_candidates','candidate_id'), ('v_recruit_candidates','customer_name'),
  ('v_recruit_candidates_trash','candidate_id'), ('v_recruit_candidates_trash','candidate_deleted_at'),
  ('v_action_center','person_id'), ('v_funnel_stats','stage')
)
SELECT 'public.' || e.table_name || '.' || e.column_name AS check_id,
       CASE WHEN c.column_name IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
       c.data_type
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = e.table_name AND c.column_name = e.column_name
ORDER BY e.table_name, e.column_name;
