-- Transactional fixtures: every business row and confirmation receipt is rolled back.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $test$
DECLARE preview jsonb; result jsonb; again jsonb; pid bigint; aid bigint; taskid bigint; runid bigint; resultid bigint; n integer;
BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_test_records) THEN RAISE EXCEPTION 'Use offline tests after persistent scene exists'; END IF;
 preview := public.crm_test_scenario_v1('dryRun','crm_test_fixture_actor');
 IF (preview#>>'{preview,initialNew}')::integer<>10 OR EXISTS(SELECT 1 FROM public.crm_test_records) THEN RAISE EXCEPTION 'dry-run wrote business data'; END IF;
 BEGIN
  PERFORM public.crm_test_scenario_v1('execute','crm_test_fixture_actor',(preview->>'previewId')::uuid);
  RAISE EXCEPTION 'Unconfirmed execute was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.crm_test_scenario_v1('confirm','crm_test_other_actor',(preview->>'previewId')::uuid,preview->>'previewHash');
  RAISE EXCEPTION 'Wrong actor was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM public.crm_test_scenario_v1('confirm','crm_test_fixture_actor',(preview->>'previewId')::uuid,preview->>'previewHash');
 result := public.crm_test_scenario_v1('execute','crm_test_fixture_actor',(preview->>'previewId')::uuid);
 IF (result->>'initialCount')::integer<>10 OR NOT (result->>'ready')::boolean THEN RAISE EXCEPTION 'Ten initial rows missing'; END IF;
 again := public.crm_test_scenario_v1('execute','crm_test_fixture_actor',(preview->>'previewId')::uuid);
 IF NOT (again->>'replayed')::boolean OR (again->>'businessDataWritten')::boolean THEN RAISE EXCEPTION 'Repeat was not idempotent'; END IF;
 preview := public.crm_test_scenario_v1('dryRun','crm_test_fixture_actor');
 IF (preview#>>'{preview,initialNew}')::integer<>0 THEN RAISE EXCEPTION 'Second preview adds seed rows'; END IF;
 pid := (result#>>'{targets,personId}')::bigint;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.crm_search_people_v1('activity_no_followup',3,50)->'rows') x WHERE (x->>'person_id')::bigint=pid) THEN RAISE EXCEPTION 'Ordinary Search excluded sample'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v_action_center WHERE person_name='【系统测试·勿联系】虚构体验甲') THEN RAISE EXCEPTION 'Ordinary action view excluded sample'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.v_funnel_stats WHERE funnel='opportunity' AND stage='发现' AND current_count>0) THEN RAISE EXCEPTION 'Ordinary funnel excluded sample'; END IF;
 BEGIN
  INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,initial_slot,seed_key,visible_label)
   VALUES('crm_test_main_v1','persons','999999999','initial',11,'eleventh','【系统测试·勿联系】超限夹具');
  RAISE EXCEPTION 'Eleventh initial slot accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO public.actions(person_id,action_type,title,source,created_by_uid)
  VALUES(pid,'other','【系统测试·勿联系】事务内衍生行动','manual','crm_test_fixture_actor') RETURNING id INTO aid;
 IF NOT EXISTS(SELECT 1 FROM public.crm_test_records WHERE record_table='actions' AND record_id=aid::text AND origin='derived') THEN RAISE EXCEPTION 'Derived row untracked'; END IF;
 INSERT INTO public.ai_tasks(task_type,subject_type,subject_id,status,input_snapshot,context_snapshot)
  VALUES('crm_test_fixture','person',pid::text,'pending','{}','{}') RETURNING id INTO taskid;
 INSERT INTO public.ai_runs(task_id) VALUES(taskid) RETURNING id INTO runid;
 INSERT INTO public.ai_results(task_id,run_id,result_json) VALUES(taskid,runid,'{"marker":"【系统测试·勿联系】"}') RETURNING id INTO resultid;
 SELECT count(*) INTO n FROM public.crm_test_records WHERE origin='ai_audit';
 IF n<>3 THEN RAISE EXCEPTION 'AI audit chain not tracked'; END IF;
 BEGIN
  UPDATE public.persons SET phone='【系统测试·勿联系】禁止联系方式' WHERE id=pid;
  RAISE EXCEPTION 'Contact address was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT count(*) FROM public.crm_test_records WHERE origin='initial')<>10 THEN RAISE EXCEPTION 'Derived rows consumed initial slots'; END IF;
END $test$;
ROLLBACK;
