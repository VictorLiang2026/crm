-- PC36 E12: fictional AI audit only. All writes are rolled back.
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL lock_timeout = '5s';
DO $test$
DECLARE
  v_claim public.ai_request_claims%ROWTYPE;
  v_task public.ai_tasks%ROWTYPE;
  v_result jsonb;
  v_context jsonb;
  v_new_task bigint;
  v_actor text := '[CRM_TEST_ONLY] PC36 search annotation guard';
  v_key text := repeat('f',64);
  v_input jsonb := '{"query":"【系统测试·勿联系】虚构查询"}'::jsonb;
  v_plain jsonb := '{"guidance":"【系统测试·勿联系】虚构条件"}'::jsonb;
  v_run bigint;
  v_blocked boolean;
BEGIN
  SELECT * INTO v_claim FROM public.ai_request_claims WHERE task_id=67;
  SELECT * INTO v_task FROM public.ai_tasks WHERE id=67 AND task_type='crm_search_query_v2';
  IF v_claim.task_id IS NULL OR v_task.id IS NULL OR v_task.status<>'completed'
     OR NOT (v_task.context_snapshot ? '_testSearch') THEN
    RAISE EXCEPTION 'Fictional search audit fixture unavailable';
  END IF;
  v_context := v_task.context_snapshot - '_testSearch';
  v_blocked := false;
  BEGIN
    PERFORM public.crm_ai_claim_v2(v_claim.actor_uid,v_claim.request_key,v_task.task_type,
      v_task.skill_name,v_task.subject_type,v_task.subject_id,v_task.capability,
      v_task.input_snapshot || '{"changed":true}'::jsonb,v_context);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'AI claim key reused with different input' THEN v_blocked := true;
    ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Changed input passed search claim guard'; END IF;
  v_blocked := false;
  BEGIN
    PERFORM public.crm_ai_claim_v2(v_claim.actor_uid,v_claim.request_key,v_task.task_type,
      v_task.skill_name,v_task.subject_type,v_task.subject_id,v_task.capability,
      v_task.input_snapshot,v_task.context_snapshot);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'AI claim key reused with different input' THEN v_blocked := true;
    ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Server annotation passed as caller input'; END IF;
  v_result := public.crm_ai_claim_v2(v_claim.actor_uid,v_claim.request_key,v_task.task_type,
    v_task.skill_name,v_task.subject_type,v_task.subject_id,v_task.capability,
    v_task.input_snapshot,v_context);
  IF v_result->>'status'<>'claimed' OR (v_result->>'taskId')::bigint=v_task.id THEN
    RAISE EXCEPTION 'Expired fictional search was not safely reclaimed';
  END IF;
  v_new_task := (v_result->>'taskId')::bigint;
  IF (public.crm_ai_claim_v2(v_claim.actor_uid,v_claim.request_key,v_task.task_type,
    v_task.skill_name,v_task.subject_type,v_task.subject_id,v_task.capability,
    v_task.input_snapshot,v_context)->>'status')<>'in_progress' THEN
    RAISE EXCEPTION 'In-progress search claim was not bounded';
  END IF;

  v_result := public.crm_ai_claim_v2(v_actor,v_key,'quick_capture_v2','quick_capture_v2',
    NULL,NULL,'analysis',v_input,v_plain);
  IF v_result->>'status'<>'claimed' THEN RAISE EXCEPTION 'Fixture claim failed'; END IF;
  v_new_task := (v_result->>'taskId')::bigint;
  INSERT INTO public.ai_runs(task_id,success) VALUES(v_new_task,NULL) RETURNING id INTO v_run;
  PERFORM public.crm_ai_finish_v1(v_new_task,v_run,true,NULL,
    '{"input_tokens":1,"output_tokens":1,"latency_ms":1}'::jsonb,
    '{"recommendation":"【系统测试·勿联系】虚构建议"}'::jsonb,true);
  UPDATE public.ai_tasks SET context_snapshot=context_snapshot || jsonb_build_object('_testSearch',
    jsonb_build_object('marker','【系统测试·勿联系】','notice','含测试数据','sources','[]'::jsonb))
    WHERE id=v_new_task;
  v_blocked := false;
  BEGIN
    PERFORM public.crm_ai_claim_v2(v_actor,v_key,'quick_capture_v2','quick_capture_v2',
      NULL,NULL,'analysis',v_input,v_plain);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='AI claim key reused with different input' THEN v_blocked:=true;
    ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Non-search annotation bypassed claim guard'; END IF;
END $test$;
ROLLBACK;
