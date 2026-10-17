-- Run as service_role. All business rows are fictional and rolled back by the sentinel exception.
DO $test$
DECLARE
  v_person_id bigint := 929301;
  v_action_id bigint;
  v_task_id bigint;
  v_run_id bigint;
  v_result_id bigint;
  v_learning_id bigint;
  v_event uuid := '00000000-0000-4000-8000-000000029301';
  v_outcome_key uuid := '00000000-0000-4000-8000-000000029302';
  v_candidate_key uuid := '00000000-0000-4000-8000-000000029303';
  v_answer jsonb;
  v_metrics jsonb;
  v_blocked boolean;
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.persons WHERE id=v_person_id) THEN RAISE EXCEPTION 'PC29 fictional test Person ID occupied'; END IF;
    INSERT INTO public.persons(id,display_name,name_key,source)
      VALUES(v_person_id,'【系统测试·勿联系】PC29虚构人物','pc29_fictional_929301','test');
    INSERT INTO public.actions(person_id,action_type,title,priority,status,source,completed_at,
      created_by_uid,completed_by_uid)
      VALUES(v_person_id,'followup','【系统测试·勿联系】PC29虚构已完成行动','medium','completed','manual',
        now(),'[CRM_TEST_ONLY] PC29 operator','[CRM_TEST_ONLY] PC29 operator') RETURNING id INTO v_action_id;
    INSERT INTO public.ai_tasks(task_type,skill_name,subject_type,subject_id,status,capability,input_snapshot,context_snapshot)
      VALUES('pc29_test','pc29_test','person',v_person_id::text,'completed','analysis','{}'::jsonb,'{}'::jsonb)
      RETURNING id INTO v_task_id;
    INSERT INTO public.ai_runs(task_id,success) VALUES(v_task_id,true) RETURNING id INTO v_run_id;
    INSERT INTO public.ai_results(task_id,run_id,result_json,rank,is_recommended)
      VALUES(v_task_id,v_run_id,'{"summary":"【系统测试·勿联系】PC29虚构建议"}'::jsonb,1,false)
      RETURNING id INTO v_result_id;

    v_answer:=public.crm_ai_experience_decide_v1('[CRM_TEST_ONLY] PC29 reviewer',v_event,v_result_id,
      'accepted',NULL,NULL);
    IF v_answer->>'replayed'<>'false' THEN RAISE EXCEPTION 'First PC29 decision was marked replay'; END IF;
    v_answer:=public.crm_ai_experience_decide_v1('[CRM_TEST_ONLY] PC29 reviewer',v_event,v_result_id,
      'accepted',NULL,NULL);
    IF v_answer->>'replayed'<>'true' OR (SELECT count(*) FROM public.ai_result_feedback_events WHERE ai_result_id=v_result_id)<>1 THEN
      RAISE EXCEPTION 'PC29 decision replay duplicated or changed the event';
    END IF;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_ai_experience_decide_v1('[CRM_TEST_ONLY] PC29 reviewer',v_event,v_result_id,'rejected','changed',NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC29 idempotency key accepted changed input'; END IF;

    v_answer:=public.crm_ai_experience_outcome_v1('[CRM_TEST_ONLY] PC29 reviewer',v_outcome_key,
      'action',v_action_id,v_result_id,'【系统测试·勿联系】PC29实际虚构结果',now(),
      '【系统测试·勿联系】PC29虚构跟进记录作为依据');
    IF v_answer->>'replayed'<>'false' THEN RAISE EXCEPTION 'First PC29 Outcome was marked replay'; END IF;
    v_answer:=public.crm_ai_experience_outcome_v1('[CRM_TEST_ONLY] PC29 reviewer',v_outcome_key,
      'action',v_action_id,v_result_id,'【系统测试·勿联系】PC29实际虚构结果',
      (SELECT occurred_at FROM public.outcomes WHERE idempotency_key=v_outcome_key),
      '【系统测试·勿联系】PC29虚构跟进记录作为依据');
    IF v_answer->>'replayed'<>'true' OR (SELECT count(*) FROM public.outcomes WHERE idempotency_key=v_outcome_key)<>1 OR
       NOT EXISTS (SELECT 1 FROM public.outcomes WHERE idempotency_key=v_outcome_key AND action_id=v_action_id
         AND ai_result_id=v_result_id AND sentiment IS NULL AND evidence IS NOT NULL AND recorded_by_uid='[CRM_TEST_ONLY] PC29 reviewer') THEN
      RAISE EXCEPTION 'PC29 Outcome replay/link/evidence failed or inferred sentiment';
    END IF;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_ai_experience_outcome_v1('[CRM_TEST_ONLY] PC29 reviewer',
        '00000000-0000-4000-8000-000000029304','action',v_action_id,v_result_id,'',now(),'evidence');
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Invalid PC29 Outcome was accepted'; END IF;

    v_answer:=public.crm_ai_experience_learning_v1('[CRM_TEST_ONLY] PC29 reviewer',v_candidate_key,
      jsonb_build_object('sourceResultIds',jsonb_build_array(v_result_id),'primaryResultId',v_result_id,
        'situation','【系统测试·勿联系】PC29虚构适用情境','recommendation','【系统测试·勿联系】PC29虚构建议',
        'actualAction','【系统测试·勿联系】PC29虚构人工行动','learning','【系统测试·勿联系】PC29虚构经验',
        'scope','fictional PC29 sample'));
    v_learning_id:=(v_answer->>'learningId')::bigint;
    IF v_answer->>'confirmed'<>'false' OR (v_answer->>'sampleSize')::integer<>1 OR
       NOT EXISTS (SELECT 1 FROM public.learnings WHERE id=v_learning_id AND NOT confirmed AND
         source_table='ai_results' AND source_id=v_result_id AND counterexamples='[]'::jsonb AND
         jsonb_array_length(provenance->'sources')=1) THEN
      RAISE EXCEPTION 'PC29 Learning candidate provenance/sample/human gate failed';
    END IF;
    v_answer:=public.crm_ai_experience_learning_v1('[CRM_TEST_ONLY] PC29 reviewer',v_candidate_key,
      jsonb_build_object('sourceResultIds',jsonb_build_array(v_result_id),'primaryResultId',v_result_id,
        'situation','【系统测试·勿联系】PC29虚构适用情境','recommendation','【系统测试·勿联系】PC29虚构建议',
        'actualAction','【系统测试·勿联系】PC29虚构人工行动','learning','【系统测试·勿联系】PC29虚构经验',
        'scope','fictional PC29 sample'));
    IF v_answer->>'replayed'<>'true' OR (SELECT count(*) FROM public.learnings WHERE candidate_key=v_candidate_key)<>1 THEN
      RAISE EXCEPTION 'PC29 Learning replay duplicated candidate';
    END IF;
    v_answer:=public.crm_ai_experience_confirm_learning_v1('[CRM_TEST_ONLY] PC29 reviewer',v_learning_id,
      '【系统测试·勿联系】由人工审核确认');
    IF v_answer->>'confirmed'<>'true' OR NOT EXISTS (SELECT 1 FROM public.learnings WHERE id=v_learning_id
      AND confirmed AND confirmed_by_uid='[CRM_TEST_ONLY] PC29 reviewer' AND user_decision IS NOT NULL) THEN
      RAISE EXCEPTION 'PC29 Learning was not human-confirmed';
    END IF;
    v_metrics:=public.crm_ai_experience_metrics_v1(30);
    IF (v_metrics->>'numerator')::bigint<>1 OR (v_metrics->>'denominator')::bigint<>1 OR
       (v_metrics->>'windowDays')::integer<>30 THEN RAISE EXCEPTION 'PC29 decision metrics mismatch'; END IF;

    RAISE EXCEPTION 'PC29_VALIDATED_ROLLED_BACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='PC29_VALIDATED_ROLLED_BACK' THEN RAISE NOTICE 'PC29 transaction passed; fictional rows rolled back'; ELSE RAISE; END IF;
  END;
END;
$test$;
