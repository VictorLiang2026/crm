-- Run as service_role. Inner block rolls back all [CRM_TEST_ONLY] rows on success.
DO $test$
DECLARE
  v_person_id bigint := 928902;
  v_interaction_id bigint;
  v_task_id bigint;
  v_run_id bigint;
  v_result_id bigint;
  v_candidate_id bigint;
  v_refs jsonb;
  v_answer jsonb;
  v_preview jsonb;
  v_opportunity_id bigint;
  v_blocked boolean;
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.persons WHERE id=v_person_id) THEN
      RAISE EXCEPTION 'Test Person ID occupied';
    END IF;
    INSERT INTO public.persons(id,display_name,name_key,source)
      VALUES (v_person_id,'[CRM_TEST_ONLY] 机会候选验证','crm_test_only_candidate','test');
    INSERT INTO public.interactions(person_id,interaction_type,interaction_at,summary,
      source_type,importance,created_by_uid)
      VALUES (v_person_id,'conversation',now(),'[CRM_TEST_ONLY] 明确提出想了解养老保障',
        'manual',4,'[CRM_TEST_ONLY] operator') RETURNING id INTO v_interaction_id;
    v_refs := jsonb_build_array('public.interactions#' || v_interaction_id::text);
    INSERT INTO public.ai_tasks(task_type,skill_name,subject_type,subject_id,status,
      capability,input_snapshot,context_snapshot)
      VALUES ('opportunity_candidate','opportunity_candidate','person',v_person_id::text,
        'completed','analysis','{}'::jsonb,'{}'::jsonb) RETURNING id INTO v_task_id;
    INSERT INTO public.ai_runs(task_id,success) VALUES (v_task_id,true)
      RETURNING id INTO v_run_id;
    INSERT INTO public.ai_results(task_id,run_id,result_json,rank,is_recommended)
      VALUES (v_task_id,v_run_id,jsonb_build_object('status','candidate',
        'opportunityType','insurance','reason','[CRM_TEST_ONLY] 养老保障沟通',
        'nextAction','先核实已有保障','confidence',0.8,'sourceRefs',v_refs),1,true)
      RETURNING id INTO v_result_id;

    v_answer := public.opportunity_candidate_v1('create','[CRM_TEST_ONLY] operator',
      NULL,v_person_id,v_result_id,'{"opportunity_type":"insurance","reason":"[CRM_TEST_ONLY] 养老保障沟通","next_action":"先核实已有保障"}'::jsonb,v_refs);
    v_candidate_id := (v_answer->>'candidateId')::bigint;
    IF v_answer->>'status'<>'draft' OR
       EXISTS (SELECT 1 FROM public.opportunities WHERE person_id=v_person_id) THEN
      RAISE EXCEPTION 'Candidate creation wrote a formal Opportunity';
    END IF;
    v_blocked:=false;
    BEGIN
      PERFORM public.opportunity_candidate_v1('execute','[CRM_TEST_ONLY] operator',v_candidate_id);
    EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Unconfirmed execution was allowed'; END IF;
    v_preview:=public.opportunity_candidate_v1('preview','[CRM_TEST_ONLY] operator',v_candidate_id);
    IF v_preview->>'status'<>'previewed' OR
       EXISTS (SELECT 1 FROM public.opportunities WHERE person_id=v_person_id) THEN
      RAISE EXCEPTION 'Preview wrote a formal Opportunity';
    END IF;
    v_blocked:=false;
    BEGIN
      PERFORM public.opportunity_candidate_v1('confirm','different-user',v_candidate_id,
        NULL,NULL,NULL,NULL,v_preview->>'previewHash');
    EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Different user confirmed preview'; END IF;
    v_blocked:=false;
    BEGIN
      PERFORM public.opportunity_candidate_v1('confirm','[CRM_TEST_ONLY] operator',v_candidate_id,
        NULL,NULL,NULL,NULL,repeat('0',32));
    EXCEPTION WHEN insufficient_privilege THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Invalid hash confirmed preview'; END IF;
    v_answer:=public.opportunity_candidate_v1('confirm','[CRM_TEST_ONLY] operator',v_candidate_id,
      NULL,NULL,NULL,NULL,v_preview->>'previewHash');
    IF v_answer->>'status'<>'confirmed' OR
       EXISTS (SELECT 1 FROM public.opportunities WHERE person_id=v_person_id) THEN
      RAISE EXCEPTION 'Confirmation wrote a formal Opportunity';
    END IF;
    v_answer:=public.opportunity_candidate_v1('execute','[CRM_TEST_ONLY] operator',v_candidate_id);
    v_opportunity_id:=(v_answer->>'opportunityId')::bigint;
    IF v_answer->>'status'<>'created' OR v_answer->>'replayed'<>'false' OR
       (SELECT count(*) FROM public.opportunities WHERE person_id=v_person_id)<>1 OR
       NOT EXISTS (SELECT 1 FROM public.opportunities WHERE id=v_opportunity_id
         AND customer_id IS NULL AND status='发现') OR
       NOT EXISTS (SELECT 1 FROM public.ai_results WHERE id=v_result_id
         AND user_selected AND final_result_json IS NOT NULL) THEN
      RAISE EXCEPTION 'Confirmed execution failed';
    END IF;
    v_answer:=public.opportunity_candidate_v1('execute','[CRM_TEST_ONLY] operator',v_candidate_id);
    IF v_answer->>'replayed'<>'true' OR
       (SELECT count(*) FROM public.opportunities WHERE person_id=v_person_id)<>1 THEN
      RAISE EXCEPTION 'Replay created a duplicate';
    END IF;
    RAISE EXCEPTION 'OPPORTUNITY_CANDIDATE_VALIDATED_ROLLED_BACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='OPPORTUNITY_CANDIDATE_VALIDATED_ROLLED_BACK' THEN
      RAISE NOTICE 'Opportunity candidate workflow passed; all marked rows rolled back';
    ELSE
      RAISE;
    END IF;
  END;
END;
$test$;
