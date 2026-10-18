-- PC33 fictional AI audit only; every write is enclosed by the outer rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $test$
DECLARE
  v_actor text := '[CRM_TEST_ONLY] PC33 actor A';
  v_other text := '[CRM_TEST_ONLY] PC33 actor B';
  v_key text := repeat('a', 64);
  v_input jsonb := '{"question":"【系统测试·勿联系】虚构提问"}'::jsonb;
  v_context jsonb := '{"source":"【系统测试·勿联系】虚构上下文","_skill":{"version":"1.0.0"}}'::jsonb;
  v_claim jsonb;
  v_task bigint;
  v_other_task bigint;
  v_run bigint;
  v_retry_run bigint;
  v_result jsonb;
  v_checks integer := 0;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'PC33 test requires service_role'; END IF;
  IF has_table_privilege('anon','public.ai_request_claims','SELECT')
     OR has_table_privilege('authenticated','public.ai_request_claims','SELECT')
     OR has_function_privilege('anon',
       'public.crm_ai_claim_v2(text,text,text,text,text,text,text,jsonb,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.crm_ai_finish_v1(bigint,bigint,boolean,text,jsonb,jsonb,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'PC33 audit privilege widened';
  END IF;
  v_checks := v_checks + 1;

  v_claim := public.crm_ai_claim_v2(v_actor,v_key,'pc33_test','pc33_test',
    NULL,NULL,'analysis',v_input,v_context);
  IF v_claim->>'status' <> 'claimed' THEN RAISE EXCEPTION 'First claim failed'; END IF;
  v_task := (v_claim->>'taskId')::bigint;
  IF (public.crm_ai_claim_v2(v_actor,v_key,'pc33_test','pc33_test',
    NULL,NULL,'analysis',v_input,v_context)->>'status') <> 'in_progress' THEN
    RAISE EXCEPTION 'Concurrent claim was not bounded';
  END IF;
  v_checks := v_checks + 1;

  BEGIN
    PERFORM public.crm_ai_claim_v2(v_actor,v_key,'pc33_test','pc33_test',
      NULL,NULL,'analysis',v_input||'{"changed":true}'::jsonb,v_context);
    RAISE EXCEPTION 'Changed input reused claim key';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Changed input reused claim key' THEN RAISE; END IF;
  END;
  v_checks := v_checks + 1;

  INSERT INTO public.ai_runs(task_id,success) VALUES(v_task,NULL) RETURNING id INTO v_run;
  v_result := public.crm_ai_finish_v1(v_task,v_run,false,'UPSTREAM_UNAVAILABLE',
    '{"latency_ms":15}'::jsonb,NULL,false);
  IF v_result->>'status' <> 'retry' OR
     (SELECT status FROM public.ai_tasks WHERE id=v_task) <> 'running' THEN
    RAISE EXCEPTION 'Retry attempt audit failed';
  END IF;
  v_checks := v_checks + 1;

  INSERT INTO public.ai_runs(task_id,success) VALUES(v_task,NULL) RETURNING id INTO v_retry_run;
  v_result := public.crm_ai_finish_v1(v_task,v_retry_run,true,NULL,
    '{"input_tokens":2,"output_tokens":1,"latency_ms":22}'::jsonb,
    '{"recommendation":"【系统测试·勿联系】虚构建议"}'::jsonb,true);
  IF v_result->>'status' <> 'completed' OR
     (SELECT status FROM public.ai_tasks WHERE id=v_task) <> 'completed' OR
     (SELECT count(*) FROM public.ai_results WHERE task_id=v_task) <> 1 THEN
    RAISE EXCEPTION 'Atomic success audit failed';
  END IF;
  v_checks := v_checks + 1;

  IF (public.crm_ai_finish_v1(v_task,v_retry_run,true,NULL,'{}'::jsonb,
    '{"recommendation":"【系统测试·勿联系】虚构建议"}'::jsonb,true)->>'resultId')
      IS DISTINCT FROM v_result->>'resultId' THEN
    RAISE EXCEPTION 'Finalization replay returned another result';
  END IF;
  IF (SELECT count(*) FROM public.ai_results WHERE task_id=v_task) <> 1 THEN
    RAISE EXCEPTION 'Finalization replay duplicated result';
  END IF;
  v_checks := v_checks + 1;

  v_claim := public.crm_ai_claim_v2(v_actor,v_key,'pc33_test','pc33_test',
    NULL,NULL,'analysis',v_input,v_context);
  IF v_claim->>'status' <> 'reused' OR (v_claim->>'taskId')::bigint <> v_task
     OR v_claim->>'resultId' IS NULL THEN
    RAISE EXCEPTION 'Completed claim did not reuse result';
  END IF;
  v_checks := v_checks + 1;

  v_claim := public.crm_ai_claim_v2(v_other,v_key,'pc33_test','pc33_test',
    NULL,NULL,'analysis',v_input,v_context);
  IF v_claim->>'status' <> 'claimed' THEN RAISE EXCEPTION 'Other actor reused result'; END IF;
  v_other_task := (v_claim->>'taskId')::bigint;
  IF v_other_task=v_task THEN RAISE EXCEPTION 'Actor isolation failed'; END IF;
  v_checks := v_checks + 1;

  UPDATE public.ai_request_claims SET expires_at=now()-interval '1 second'
    WHERE actor_uid=v_other AND request_key=v_key;
  IF (public.crm_ai_claim_v2(v_other,v_key,'pc33_test','pc33_test',
    NULL,NULL,'analysis',v_input,v_context)->>'status') <> 'audit_unknown' THEN
    RAISE EXCEPTION 'Expired running claim silently retried model';
  END IF;
  v_checks := v_checks + 1;

  INSERT INTO public.ai_runs(task_id,success) VALUES(v_other_task,NULL) RETURNING id INTO v_run;
  BEGIN
    PERFORM public.crm_ai_finish_v1(v_other_task,v_run,true,NULL,
      '{"input_tokens":-1,"latency_ms":1}'::jsonb,
      '{"recommendation":"【系统测试·勿联系】不应保存"}'::jsonb,true);
    RAISE EXCEPTION 'Invalid usage did not rollback audit';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Invalid usage did not rollback audit' THEN RAISE; END IF;
  END;
  IF (SELECT success FROM public.ai_runs WHERE id=v_run) IS NOT NULL
     OR (SELECT count(*) FROM public.ai_results WHERE task_id=v_other_task) <> 0
     OR (SELECT status FROM public.ai_tasks WHERE id=v_other_task) <> 'running' THEN
    RAISE EXCEPTION 'Failed finalization partially wrote audit';
  END IF;
  v_checks := v_checks + 1;

  v_result := public.crm_ai_finish_v1(v_other_task,v_run,false,'TIMEOUT',
    '{"latency_ms":30000}'::jsonb,NULL,true);
  IF v_result->>'status' <> 'failed' OR
     (SELECT status FROM public.ai_tasks WHERE id=v_other_task) <> 'failed' OR
     (SELECT count(*) FROM public.ai_results WHERE task_id=v_other_task) <> 0 THEN
    RAISE EXCEPTION 'Terminal failure audit failed';
  END IF;
  v_checks := v_checks + 1;
  IF v_checks <> 11 THEN RAISE EXCEPTION 'PC33 audit test count %',v_checks; END IF;
END $test$;
SELECT 'PC33_AI_AUDIT_11_PASS_ROLLED_BACK' AS test_result;
ROLLBACK;
