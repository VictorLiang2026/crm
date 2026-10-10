-- Verify all 11 views work after rebuild
SELECT 'customers_view' AS view, count(*) AS rows FROM public.customers_view
UNION ALL SELECT 'followups_view', count(*) FROM public.followups_view
UNION ALL SELECT 'gifts_view', count(*) FROM public.gifts_view
UNION ALL SELECT 'photos_view', count(*) FROM public.photos_view
UNION ALL SELECT 'products_view', count(*) FROM public.products_view
UNION ALL SELECT 'ai_recommendations_view', count(*) FROM public.ai_recommendations_view
UNION ALL SELECT 'v_action_center', count(*) FROM public.v_action_center
UNION ALL SELECT 'v_recruit_candidates', count(*) FROM public.v_recruit_candidates
UNION ALL SELECT 'v_recruit_candidates_person_only', count(*) FROM public.v_recruit_candidates_person_only
UNION ALL SELECT 'v_recruit_candidates_person_only_trash', count(*) FROM public.v_recruit_candidates_person_only_trash
UNION ALL SELECT 'v_recruit_candidates_trash', count(*) FROM public.v_recruit_candidates_trash;
