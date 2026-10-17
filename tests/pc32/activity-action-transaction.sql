-- PC32 Activity Action: only registered fictional Activity 11, Person 783,
-- AI result 19 and attended participant 18. Every edit rolls back.
DO $test$
DECLARE
  v_actor text := '2102162853214060545';
  v_other text := '[CRM_TEST_ONLY] PC32 other activity actor';
  v_activity bigint := 11;
  v_person bigint := 783;
  v_ai_result bigint := 19;
  v_participant bigint := 18;
  v_ai_before jsonb;
  v_key uuid := pg_catalog.gen_random_uuid();
  v_duplicate_key uuid := pg_catalog.gen_random_uuid();
  v_payload jsonb := jsonb_build_object(
    'title','【系统测试·勿联系】核对虚构活动反馈材料',
    'description','【系统测试·勿联系】PC32 Action 来源事务测试',
    'dueAt',NULL,'priority','medium');
  v_before_actions integer;
  v_before_claims integer;
  v_before_commands integer;
  v_preview jsonb;
  v_result jsonb;
  v_action bigint;
  v_blocked boolean;
  v_checks integer := 0;
BEGIN
  IF current_user<>'service_role' OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r
    WHERE r.batch_key='crm_test_main_v1' AND r.record_table='activities'
      AND r.record_id=v_activity::text) OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r
    WHERE r.batch_key='crm_test_main_v1' AND r.record_table='persons'
      AND r.record_id=v_person::text) OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r
    WHERE r.batch_key='crm_test_main_v1' AND r.record_table='ai_results'
      AND r.record_id=v_ai_result::text) OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r
    WHERE r.batch_key='crm_test_main_v1' AND r.record_table='activity_participants'
      AND r.record_id=v_participant::text) OR NOT EXISTS(
    SELECT 1 FROM public.activity_participants
    WHERE id=v_participant AND activity_id=v_activity AND
      canonical_person_id=v_person AND status='attended' AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'PC32 fictional activity Action sources unavailable'; END IF;
  SELECT result_json INTO v_ai_before FROM public.ai_results WHERE id=v_ai_result;
  IF v_ai_before IS NULL OR v_ai_before->'actionCandidates'->0->>'personId'<>v_person::text OR
     EXISTS(SELECT 1 FROM public.crm_activity_review_source_claims
       WHERE activity_id=v_activity AND operation='action' AND
         person_id=v_person AND source_ref='public.activity_participants#18')
  THEN RAISE EXCEPTION 'PC32 activity Action baseline changed'; END IF;
  SELECT count(*) INTO v_before_actions FROM public.actions
    WHERE activity_id=v_activity AND person_id=v_person;
  SELECT count(*) INTO v_before_claims FROM public.crm_activity_review_source_claims
    WHERE activity_id=v_activity;
  SELECT count(*) INTO v_before_commands FROM public.crm_activity_review_commands
    WHERE activity_id=v_activity;
  BEGIN
    UPDATE public.ai_results SET result_json=jsonb_set(result_json,
      '{actionCandidates,0,sourceRefs}',
      jsonb_build_array('public.activity_participants#18'))
    WHERE id=v_ai_result;
    IF NOT FOUND THEN RAISE EXCEPTION 'PC32 fictional AI result missing'; END IF;
    v_preview:=public.crm_activity_review_preview_v1(v_actor,v_key,'action',
      v_activity,v_ai_result,0,v_payload);
    IF (v_preview->>'previewId')::uuid<>v_key OR
       v_preview->>'businessDataWritten'<>'false' OR
       v_preview->'sourceRefs'<>jsonb_build_array('public.activity_participants#18') OR
       (SELECT count(*) FROM public.actions
         WHERE activity_id=v_activity AND person_id=v_person)<>v_before_actions
    THEN RAISE EXCEPTION 'PC32 Action preview changed business data'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      v_result:=public.crm_activity_review_execute_v1(v_actor,v_key);
      v_action:=(v_result->>'actionId')::bigint;
      IF v_result->>'replayed'<>'false' OR v_action IS NULL OR
         NOT EXISTS(SELECT 1 FROM public.actions
           WHERE id=v_action AND activity_id=v_activity AND person_id=v_person) OR
         NOT EXISTS(SELECT 1 FROM public.crm_activity_review_source_claims
           WHERE command_id=v_key AND source_ref='public.activity_participants#18')
      THEN RAISE EXCEPTION 'PC32 Action first execute lacked Action or source claim'; END IF;
      RAISE EXCEPTION 'PC32 injected post-source-claim failure' USING ERRCODE='P32A3';
    EXCEPTION WHEN SQLSTATE 'P32A3' THEN NULL;
    END;
    IF (SELECT count(*) FROM public.actions
        WHERE activity_id=v_activity AND person_id=v_person)<>v_before_actions OR
       (SELECT count(*) FROM public.crm_activity_review_source_claims
        WHERE activity_id=v_activity)<>v_before_claims OR
       NOT EXISTS(SELECT 1 FROM public.crm_activity_review_commands
        WHERE id=v_key AND executed_at IS NULL)
    THEN RAISE EXCEPTION 'PC32 Action failure left partial source claim'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_activity_review_execute_v1(v_actor,v_key);
    v_action:=(v_result->>'actionId')::bigint;
    IF v_result->>'replayed'<>'false' OR v_action IS NULL OR
       (SELECT count(*) FROM public.actions
         WHERE activity_id=v_activity AND person_id=v_person)<>v_before_actions+1 OR
       (SELECT count(*) FROM public.crm_activity_review_source_claims
         WHERE activity_id=v_activity AND command_id=v_key)<>1
    THEN RAISE EXCEPTION 'PC32 Action retry did not write exactly once'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_activity_review_execute_v1(v_actor,v_key);
    IF v_result->>'replayed'<>'true' OR v_result->>'businessDataWritten'<>'false' OR
       (v_result->>'actionId')::bigint<>v_action OR
       (SELECT count(*) FROM public.actions
         WHERE activity_id=v_activity AND person_id=v_person)<>v_before_actions+1
    THEN RAISE EXCEPTION 'PC32 Action replay duplicated business data'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_activity_review_execute_v1(v_other,v_key);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 Action replay accepted different actor'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_activity_review_preview_v1(v_actor,v_duplicate_key,'action',
        v_activity,v_ai_result,0,v_payload);
    EXCEPTION WHEN SQLSTATE '23505' THEN v_blocked:=true;
    END;
    IF NOT v_blocked OR
       (SELECT count(*) FROM public.crm_activity_review_source_claims
         WHERE activity_id=v_activity AND source_ref='public.activity_participants#18')<>1
    THEN RAISE EXCEPTION 'PC32 Action source was accepted twice'; END IF;
    v_checks:=v_checks+1;
    RAISE EXCEPTION 'PC32_ACTION_TEST_ROLLBACK' USING ERRCODE='P32A4';
  EXCEPTION WHEN SQLSTATE 'P32A4' THEN NULL;
  END;
  IF (SELECT result_json FROM public.ai_results WHERE id=v_ai_result) IS DISTINCT FROM v_ai_before OR
     (SELECT count(*) FROM public.actions
       WHERE activity_id=v_activity AND person_id=v_person)<>v_before_actions OR
     (SELECT count(*) FROM public.crm_activity_review_source_claims
       WHERE activity_id=v_activity)<>v_before_claims OR
     (SELECT count(*) FROM public.crm_activity_review_commands
       WHERE activity_id=v_activity)<>v_before_commands
  THEN RAISE EXCEPTION 'PC32 activity Action test leaked source or business rows'; END IF;
  RAISE NOTICE 'PC32 activity Action passed % checks; all edits rolled back',v_checks;
END $test$;
