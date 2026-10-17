-- PC32-B live service_role test. Reuses registered fictional Person 783 and Interaction 10.
-- All generated task/result/candidate/opportunity/registry rows roll back.
DO $test$
DECLARE
  v_person_id bigint := 783;
  v_source_id bigint := 10;
  v_actor text := '[CRM_TEST_ONLY] PC32-B reviewer';
  v_other text := '[CRM_TEST_ONLY] PC32-B other';
  v_reason text := '【系统测试·勿联系】PC32-B 虚构机会重试核验';
  v_task_id bigint;
  v_run_id bigint;
  v_result_id bigint;
  v_candidate_id bigint;
  v_opportunity_id bigint;
  v_refs jsonb;
  v_answer jsonb;
  v_preview jsonb;
  v_blocked boolean;
  v_checks integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crm_test_records r
      WHERE r.batch_key='crm_test_main_v1' AND r.record_table='persons'
        AND r.record_id=v_person_id::text) OR NOT EXISTS (
      SELECT 1 FROM public.interactions i WHERE i.id=v_source_id AND i.person_id=v_person_id
  ) THEN RAISE EXCEPTION 'PC32-B registered fictional source unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.opportunities o
      WHERE o.person_id=v_person_id AND o.last_progress=v_reason) THEN
    RAISE EXCEPTION 'PC32-B fixture Opportunity already exists';
  END IF;
  BEGIN
    v_refs := jsonb_build_array('public.interactions#'||v_source_id::text);
    INSERT INTO public.ai_tasks(task_type,skill_name,subject_type,subject_id,status,
      capability,input_snapshot,context_snapshot)
      VALUES('opportunity_candidate','opportunity_candidate','person',v_person_id::text,
        'completed','analysis','{}'::jsonb,'{}'::jsonb) RETURNING id INTO v_task_id;
    INSERT INTO public.ai_runs(task_id,success) VALUES(v_task_id,true) RETURNING id INTO v_run_id;
    INSERT INTO public.ai_results(task_id,run_id,result_json,rank,is_recommended)
      VALUES(v_task_id,v_run_id,jsonb_build_object('status','candidate',
        'opportunityType','insurance','reason',v_reason,
        'nextAction','【系统测试·勿联系】仅核对虚构方案','confidence',0.8,'sourceRefs',v_refs),1,true)
      RETURNING id INTO v_result_id;
    v_answer := public.opportunity_candidate_v1('create',v_actor,NULL,v_person_id,v_result_id,
      jsonb_build_object('opportunity_type','insurance','reason',v_reason,
        'next_action','【系统测试·勿联系】仅核对虚构方案'),v_refs);
    v_candidate_id := (v_answer->>'candidateId')::bigint;
    IF v_answer->>'status'<>'draft' OR v_candidate_id IS NULL THEN
      RAISE EXCEPTION 'PC32-B create failed';
    END IF;
    v_checks := v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.opportunity_candidate_v1('execute',v_actor,v_candidate_id);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-B unconfirmed execute accepted'; END IF;
    v_checks := v_checks+1;
    v_preview := public.opportunity_candidate_v1('preview',v_actor,v_candidate_id);
    IF v_preview->>'status'<>'previewed' OR EXISTS (
      SELECT 1 FROM public.opportunities o WHERE o.person_id=v_person_id AND o.last_progress=v_reason
    ) THEN RAISE EXCEPTION 'PC32-B preview wrote business data'; END IF;
    v_checks := v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.opportunity_candidate_v1('confirm',v_other,v_candidate_id,
        NULL,NULL,NULL,NULL,v_preview->>'previewHash');
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-B other actor confirmed preview'; END IF;
    v_checks := v_checks+1;
    v_answer := public.opportunity_candidate_v1('confirm',v_actor,v_candidate_id,
      NULL,NULL,NULL,NULL,v_preview->>'previewHash');
    IF v_answer->>'status'<>'confirmed' THEN RAISE EXCEPTION 'PC32-B confirm failed'; END IF;
    v_checks := v_checks+1;
    -- Inject an application failure after the RPC returns. The enclosing
    -- subtransaction must undo Opportunity, candidate state, and AI selection.
    BEGIN
      v_answer := public.opportunity_candidate_v1('execute',v_actor,v_candidate_id);
      IF v_answer->>'status'<>'created' OR v_answer->>'replayed'<>'false' THEN
        RAISE EXCEPTION 'PC32-B first execute failed';
      END IF;
      RAISE EXCEPTION 'PC32-B injected post-execute failure' USING ERRCODE='P32B1';
    EXCEPTION WHEN SQLSTATE 'P32B1' THEN NULL;
    END;
    IF EXISTS (SELECT 1 FROM public.opportunities o
        WHERE o.person_id=v_person_id AND o.last_progress=v_reason) OR
       EXISTS (SELECT 1 FROM public.opportunity_candidates c
        WHERE c.id=v_candidate_id AND c.status<>'confirmed') OR
       EXISTS (SELECT 1 FROM public.ai_results r
        WHERE r.id=v_result_id AND r.user_selected) THEN
      RAISE EXCEPTION 'PC32-B post-write failure left partial records';
    END IF;
    v_checks := v_checks+1;
    v_answer := public.opportunity_candidate_v1('execute',v_actor,v_candidate_id);
    v_opportunity_id := (v_answer->>'opportunityId')::bigint;
    IF v_answer->>'status'<>'created' OR v_answer->>'replayed'<>'false' OR
       (SELECT count(*) FROM public.opportunities o WHERE o.id=v_opportunity_id
          AND o.person_id=v_person_id AND o.customer_id IS NULL)<>1 OR
       NOT EXISTS(SELECT 1 FROM public.ai_results r WHERE r.id=v_result_id
          AND r.user_selected AND r.final_result_json IS NOT NULL) THEN
      RAISE EXCEPTION 'PC32-B first execute transaction failed';
    END IF;
    v_checks := v_checks+1;
    v_answer := public.opportunity_candidate_v1('execute',v_actor,v_candidate_id);
    IF v_answer->>'replayed'<>'true' OR (v_answer->>'opportunityId')::bigint<>v_opportunity_id OR
       (SELECT count(*) FROM public.opportunities o
         WHERE o.person_id=v_person_id AND o.last_progress=v_reason)<>1 THEN
      RAISE EXCEPTION 'PC32-B same actor replay duplicated Opportunity';
    END IF;
    v_checks := v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.opportunity_candidate_v1('execute',v_other,v_candidate_id);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-B replay accepted different actor'; END IF;
    v_checks := v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.opportunity_candidate_v1('execute',NULL,v_candidate_id);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-B replay accepted missing actor'; END IF;
    v_checks := v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.opportunity_candidate_v1('execute',v_actor,v_candidate_id,
        NULL,NULL,NULL,NULL,repeat('0',32));
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-B replay accepted extra preview hash'; END IF;
    v_checks := v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.opportunity_candidate_v1('execute',v_actor,v_candidate_id,
        NULL,NULL,'{}'::jsonb);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-B replay accepted extra draft'; END IF;
    v_checks := v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.opportunity_candidate_v1('execute',v_actor,v_candidate_id,
        v_person_id);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-B replay accepted generation fields'; END IF;
    v_checks := v_checks+1;
    IF (SELECT count(*) FROM public.opportunities o WHERE o.person_id=v_person_id
        AND o.last_progress=v_reason)<>1 THEN
      RAISE EXCEPTION 'PC32-B malformed replay changed business data';
    END IF;
    v_checks := v_checks+1;
    RAISE EXCEPTION 'PC32_B_TEST_ROLLBACK' USING ERRCODE='P32B0';
  EXCEPTION WHEN SQLSTATE 'P32B0' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.opportunities o WHERE o.person_id=v_person_id
      AND o.last_progress=v_reason) OR
     EXISTS (SELECT 1 FROM public.ai_results r WHERE r.id=v_result_id) OR
     EXISTS (SELECT 1 FROM public.opportunity_candidates c WHERE c.id=v_candidate_id) OR
     EXISTS (SELECT 1 FROM public.crm_test_records r
      WHERE r.record_table='opportunities' AND r.record_id=v_opportunity_id::text) THEN
    RAISE EXCEPTION 'PC32-B fixture rollback left persisted rows';
  END IF;
  RAISE NOTICE 'PC32-B opportunity replay passed % assertions; all fixture rows rolled back',v_checks;
END;
$test$;
