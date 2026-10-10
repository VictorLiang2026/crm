SELECT viewname, definition
FROM pg_views
WHERE schemaname = 'public'
AND viewname IN (
  'customers_view', 'followups_view', 'gifts_view', 'photos_view',
  'products_view', 'ai_recommendations_view', 'v_action_center',
  'v_recruit_candidates', 'v_recruit_candidates_person_only',
  'v_recruit_candidates_person_only_trash', 'v_recruit_candidates_trash'
)
ORDER BY viewname;
