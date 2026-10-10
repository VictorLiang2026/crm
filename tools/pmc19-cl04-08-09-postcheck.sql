-- Post-check for CL-04/CL-08/CL-09: verify all objects dropped, data intact, views work
WITH checks AS (
  SELECT
    -- CL-04: composite FKs should be gone, simple FKs should remain
    (SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name = 'opportunities_customer_person_fk' AND table_schema = 'public') AS opp_composite_fk,
    (SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name = 'recruit_candidates_customer_person_fk' AND table_schema = 'public') AS rc_composite_fk,
    (SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name = 'opportunities_person_fk' AND table_schema = 'public') AS opp_person_fk,
    (SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name = 'recruit_candidates_person_fk' AND table_schema = 'public') AS rc_person_fk,
    -- CL-08: bridge trigger+function gone
    (SELECT count(*) FROM information_schema.triggers WHERE trigger_name = 'customer_person_identity_bridge_trigger' AND trigger_schema = 'public') AS bridge_trigger,
    (SELECT count(*) FROM information_schema.routines WHERE routine_name = 'customer_person_identity_bridge' AND routine_schema = 'public') AS bridge_function,
    -- CL-09: recruit sync trigger+function gone
    (SELECT count(*) FROM information_schema.triggers WHERE trigger_name = 'recruit_candidate_person_sync_trigger' AND trigger_schema = 'public') AS recruit_sync_trigger,
    (SELECT count(*) FROM information_schema.routines WHERE routine_name = 'recruit_candidate_person_sync' AND routine_schema = 'public') AS recruit_sync_function,
    -- Data counts unchanged
    (SELECT count(*) FROM public.customers) AS customers_total,
    (SELECT count(*) FROM public.persons) AS persons_total,
    (SELECT count(*) FROM public.opportunities) AS opp_total,
    (SELECT count(*) FROM public.recruit_candidates) AS rc_total,
    -- Views still work
    (SELECT count(*) FROM public.customers_view) AS customers_view_rows,
    (SELECT count(*) FROM public.v_recruit_candidates) AS v_recruit_rows,
    (SELECT count(*) FROM public.v_recruit_candidates_trash) AS v_recruit_trash_rows,
    (SELECT count(*) FROM public.v_action_center) AS v_action_center_rows
)
SELECT * FROM checks;
