BEGIN READ ONLY;
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT public.crm_test_disclosure_v1('[]'::jsonb,'funnel') AS internal_anon_summary;
DO $test$ BEGIN
 BEGIN PERFORM 1 FROM public.crm_test_records LIMIT 1; RAISE EXCEPTION 'ID manifest exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.crm_test_batches LIMIT 1; RAISE EXCEPTION 'Batch manifest exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_catalog.set_config('request.jwt.claims','{"role":"anon","sub":"crm_test_fake_user"}',true);
 BEGIN PERFORM public.crm_test_disclosure_v1('[]'::jsonb,'funnel'); RAISE EXCEPTION 'Public caller bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims','{"role":"authenticated","sub":"crm_test_fake_user"}',true);
DO $test$ BEGIN
 BEGIN PERFORM 1 FROM public.crm_test_records LIMIT 1; RAISE EXCEPTION 'ID manifest exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.crm_test_batches LIMIT 1; RAISE EXCEPTION 'Batch manifest exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.crm_test_disclosure_v1('[]'::jsonb,'funnel'); RAISE EXCEPTION 'Authenticated caller bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT public.crm_test_disclosure_v1('[]'::jsonb,'funnel') AS service_summary;
SELECT (SELECT count(*) FROM public.crm_test_batches) AS batches,(SELECT count(*) FROM public.crm_test_records) AS records;
ROLLBACK;
