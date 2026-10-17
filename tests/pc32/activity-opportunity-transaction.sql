-- PC32 Activity Opportunity: registered fictional Activity 11, Person 783,
-- AI result 19 and substantive Interaction 11 only. All edits roll back.
DO $test$
DECLARE
  v_actor text := '2102162853214060545';
  v_other text := '[CRM_TEST_ONLY] PC32 other activity actor';
  v_activity bigint := 11;
  v_person bigint := 783;
  v_ai_result bigint := 19;
  v_interaction bigint := 11;
  v_ai_before jsonb;
  v_key uuid := pg_catalog.gen_random_uuid();
  v_duplicate_key uuid := pg_catalog.gen_random_uuid();
  v_payload jsonb := jsonb_build_object('type','activity',
    'reason','【系统测试·勿联系】PC32 虚构活动机会候选来源核验',
    'nextAction','【系统测试·勿联系】仅作人工审核候选，不联系');
  v_before_candidates integer;
  v_before_claims integer;
  v_before_commands integer;
  v_preview jsonb;
  v_result jsonb;
  v_candidate bigint;
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
    WHERE r.batch_key='crm_test_main_v1' AND r.record_table='interactions'
      AND r.record_id=v_interaction::text) OR NOT EXISTS(
    SELECT 1 FROM public.interactions WHERE id=v_interaction AND
      activity_id=v_activity AND person_id=v_person AND importance>=3)
  THEN RAISE EXCEPTION 'PC32 fictional activity Opportunity sources unavailable'; END IF;
  SELECT result_json INTO v_ai_before FROM public.ai_results WHERE id=v_ai_result;
  IF v_ai_before IS NULL OR EXISTS(
    SELECT 1 FROM public.crm_activity_review_source_claims
    WHERE activity_id=v_activity AND operation='opportunity' AND
      person_id=v_person AND source_ref='public.interactions#11') OR NOT EXISTS(
    SELECT 1 FROM public.ai_tasks t JOIN public.ai_results r ON r.task_id=t.id
    WHERE r.id=v_ai_result AND t.status='completed' AND
      t.skill_name='activity_review' AND t.subject_type='activity' AND
      t.subject_id=v_activity::text AND EXISTS(
      SELECT 1 FROM jsonb_path_query(t.context_snapshot,'$.**.source') s
      WHERE s->>'schema'='public' AND s->>'table'='interactions'
        AND s->>'id'=v_interaction::text))
  THEN RAISE EXCEPTION 'PC32 Activity Opportunity baseline changed'; END IF;
  SELECT count(*) INTO v_before_candidates FROM public.opportunity_candidates
    WHERE ai_result_id=v_ai_result AND person_id=v_person;
  SELECT count(*) INTO v_before_claims FROM public.crm_activity_review_source_claims
    WHERE activity_id=v_activity;
  SELECT count(*) INTO v_before_commands FROM public.crm_activity_review_commands
    WHERE activity_id=v_activity;
  BEGIN
    UPDATE public.ai_results SET result_json=jsonb_set(result_json,
      '{opportunityCandidates}',jsonb_build_array(jsonb_build_object(
        'personId',v_person,'opportunityType','activity',
        'sourceRefs',jsonb_build_array('public.interactions#11'))),true)
    WHERE id=v_ai_result;
    IF NOT FOUND THEN RAISE EXCEPTION 'PC32 fictional AI result missing'; END IF;
    v_preview:=public.crm_activity_review_preview_v1(v_actor,v_key,
      'opportunity',v_activity,v_ai_result,0,v_payload);
    IF (v_preview->>'previewId')::uuid<>v_key OR
       v_preview->>'businessDataWritten'<>'false' OR
       v_preview->'sourceRefs'<>jsonb_build_array('public.interactions#11') OR
       (SELECT count(*) FROM public.opportunity_candidates
         WHERE ai_result_id=v_ai_result AND person_id=v_person)<>v_before_candidates
    THEN RAISE EXCEPTION 'PC32 Opportunity preview changed business data'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      v_result:=public.crm_activity_review_execute_v1(v_actor,v_key);
      v_candidate:=(v_result->>'candidateId')::bigint;
      IF v_result->>'replayed'<>'false' OR v_candidate IS NULL OR
         NOT EXISTS(SELECT 1 FROM public.opportunity_candidates
           WHERE id=v_candidate AND ai_result_id=v_ai_result AND person_id=v_person) OR
         NOT EXISTS(SELECT 1 FROM public.crm_activity_review_source_claims
           WHERE command_id=v_key AND source_ref='public.interactions#11')
      THEN RAISE EXCEPTION 'PC32 Opportunity first execute lacked candidate or source claim'; END IF;
      RAISE EXCEPTION 'PC32 injected post-source-claim failure' USING ERRCODE='P32O5';
    EXCEPTION WHEN SQLSTATE 'P32O5' THEN NULL;
    END;
    IF (SELECT count(*) FROM public.opportunity_candidates
        WHERE ai_result_id=v_ai_result AND person_id=v_person)<>v_before_candidates OR
       (SELECT count(*) FROM public.crm_activity_review_source_claims
        WHERE activity_id=v_activity)<>v_before_claims OR
       NOT EXISTS(SELECT 1 FROM public.crm_activity_review_commands
        WHERE id=v_key AND executed_at IS NULL)
    THEN RAISE EXCEPTION 'PC32 Opportunity failure left partial source claim'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_activity_review_execute_v1(v_actor,v_key);
    v_candidate:=(v_result->>'candidateId')::bigint;
    IF v_result->>'replayed'<>'false' OR v_candidate IS NULL OR
       (SELECT count(*) FROM public.opportunity_candidates
         WHERE ai_result_id=v_ai_result AND person_id=v_person)<>v_before_candidates+1 OR
       (SELECT count(*) FROM public.crm_activity_review_source_claims
         WHERE activity_id=v_activity AND command_id=v_key)<>1 OR
       NOT EXISTS(SELECT 1 FROM public.crm_test_records
         WHERE batch_key='crm_test_main_v1' AND
           record_table='opportunity_candidates' AND record_id=v_candidate::text)
    THEN RAISE EXCEPTION 'PC32 Opportunity retry did not write exactly once'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_activity_review_execute_v1(v_actor,v_key);
    IF v_result->>'replayed'<>'true' OR v_result->>'businessDataWritten'<>'false' OR
       (v_result->>'candidateId')::bigint<>v_candidate OR
       (SELECT count(*) FROM public.opportunity_candidates
         WHERE ai_result_id=v_ai_result AND person_id=v_person)<>v_before_candidates+1
    THEN RAISE EXCEPTION 'PC32 Opportunity replay duplicated candidate'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_activity_review_execute_v1(v_other,v_key);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 Opportunity replay accepted other actor'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_activity_review_preview_v1(v_actor,v_duplicate_key,
        'opportunity',v_activity,v_ai_result,0,v_payload);
    EXCEPTION WHEN SQLSTATE '23505' THEN v_blocked:=true;
    END;
    IF NOT v_blocked OR
       (SELECT count(*) FROM public.crm_activity_review_source_claims
         WHERE activity_id=v_activity AND source_ref='public.interactions#11')<>1
    THEN RAISE EXCEPTION 'PC32 Opportunity source was accepted twice'; END IF;
    v_checks:=v_checks+1;
    RAISE EXCEPTION 'PC32_OPPORTUNITY_TEST_ROLLBACK' USING ERRCODE='P32O6';
  EXCEPTION WHEN SQLSTATE 'P32O6' THEN NULL;
  END;
  IF (SELECT result_json FROM public.ai_results WHERE id=v_ai_result) IS DISTINCT FROM v_ai_before OR
     (SELECT count(*) FROM public.opportunity_candidates
       WHERE ai_result_id=v_ai_result AND person_id=v_person)<>v_before_candidates OR
     (SELECT count(*) FROM public.crm_activity_review_source_claims
       WHERE activity_id=v_activity)<>v_before_claims OR
     (SELECT count(*) FROM public.crm_activity_review_commands
       WHERE activity_id=v_activity)<>v_before_commands
  THEN RAISE EXCEPTION 'PC32 Activity Opportunity test leaked source or candidate'; END IF;
  RAISE NOTICE 'PC32 Activity Opportunity passed % checks; all edits rolled back',v_checks;
END $test$;
