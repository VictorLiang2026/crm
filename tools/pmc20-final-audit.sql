-- PMC-20 final DB audit
SELECT jsonb_pretty(jsonb_build_object(
  'columns', (
    SELECT jsonb_agg(jsonb_build_object('t', table_name, 'c', column_name))
    FROM information_schema.columns
    WHERE table_schema='public'
      AND ((table_name='customers' AND column_name IN ('customer_name','phone','birthday','gender','occupation','education','wx_account'))
        OR (table_name='persons' AND column_name='legacy_customer_id')
        OR (table_name='recruit_candidates' AND column_name IN ('education','mbti')))
  ),
  'customers_person_id', (
    SELECT jsonb_build_object('nullable', is_nullable, 'data_type', data_type)
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='person_id'
  ),
  'constraints', (
    SELECT jsonb_agg(conname ORDER BY conname)
    FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid JOIN pg_namespace n ON t.relnamespace=n.oid
    WHERE n.nspname='public'
      AND conname IN ('客户列表_姓名_key','opportunities_customer_person_fk','recruit_candidates_customer_person_fk',
                      'persons_legacy_customer_id_key','persons_legacy_customer_id_id_unique')
  ),
  'triggers', (
    SELECT jsonb_agg(jsonb_build_object('name', t.tgname, 'table', c.relname) ORDER BY t.tgname)
    FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND NOT t.tgisinternal
      AND t.tgname IN ('customer_person_identity_bridge_trigger','recruit_candidate_person_sync_trigger',
                       'crm_person_role_persons_sync','pmc18_customers_basics_audit')
  ),
  'dropped_functions', (
    SELECT jsonb_agg(proname) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
    WHERE n.nspname='public' AND proname IN ('customer_person_identity_bridge','recruit_candidate_person_sync','pmc18_customers_basics_audit')
  ),
  'updated_functions', (
    SELECT jsonb_agg(proname ORDER BY proname) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
    WHERE n.nspname='public' AND proname IN
      ('crm_customers_page_v1','person_directory_page_v1','person_identity_execute_v1',
       'person_identity_preview_v1','crm_test_scenario_v1','pmc18_collect_metrics','crm_person_role_sync_v1')
  ),
  'counts', (
    SELECT jsonb_build_object(
      'persons', (SELECT count(*) FROM public.persons),
      'persons_active', (SELECT count(*) FROM public.persons WHERE deleted_at IS NULL),
      'customers', (SELECT count(*) FROM public.customers),
      'customers_active', (SELECT count(*) FROM public.customers WHERE deleted_at IS NULL),
      'customers_without_person', (SELECT count(*) FROM public.customers WHERE person_id IS NULL),
      'recruits', (SELECT count(*) FROM public.recruit_candidates),
      'recruits_active', (SELECT count(*) FROM public.recruit_candidates WHERE deleted_at IS NULL),
      'recruits_without_person', (SELECT count(*) FROM public.recruit_candidates WHERE person_id IS NULL AND deleted_at IS NULL),
      'opportunities', (SELECT count(*) FROM public.opportunities),
      'views_customers', (SELECT count(*) FROM public.customers_view),
      'views_recruit', (SELECT count(*) FROM public.v_recruit_candidates),
      'views_recruit_trash', (SELECT count(*) FROM public.v_recruit_candidates_trash)
    )
  )
));
