-- Run as service_role as one DO statement. The final exception rolls back
-- every marked fixture and Action after all assertions have passed.
DO $test$
DECLARE
  v_plan jsonb;
  v_preview jsonb;
  v_confirm jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_id uuid;
  v_action_id bigint;
  v_blocked boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.persons WHERE id = 928901) THEN
    RAISE EXCEPTION 'Marked Person fixture is occupied';
  END IF;
  INSERT INTO public.persons(id,display_name,name_key,source)
    VALUES (928901,'[CRM_TEST_ONLY] 命令验证','crm_test_only_command','test');
  v_plan := public.assistant_action_command_v1('plan','[CRM_TEST_ONLY] operator',NULL,928901,
    '{"action_type":"followup","title":"[CRM_TEST_ONLY] 完成回访","description":"隔离验证","priority":"medium"}'::jsonb,NULL);
  v_id := (v_plan->>'commandId')::uuid;
  IF v_plan->>'status' <> 'planned' OR
     EXISTS (SELECT 1 FROM public.actions WHERE person_id=928901) THEN
    RAISE EXCEPTION 'Plan changed business data';
  END IF;
  v_blocked := false;
  BEGIN
    PERFORM public.assistant_action_command_v1('execute','[CRM_TEST_ONLY] operator',v_id);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Unconfirmed execute was accepted'; END IF;
  v_preview := public.assistant_action_command_v1('preview','[CRM_TEST_ONLY] operator',v_id);
  IF v_preview->>'status' <> 'previewed' OR
     v_preview#>>'{preview,person,displayName}' <> '[CRM_TEST_ONLY] 命令验证' OR
     EXISTS (SELECT 1 FROM public.actions WHERE person_id=928901) THEN
    RAISE EXCEPTION 'Preview was not read-only or had wrong Person';
  END IF;
  v_blocked := false;
  BEGIN
    PERFORM public.assistant_action_command_v1('confirm','another-user',v_id,NULL,NULL,
      v_preview->>'previewHash');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Wrong actor confirmed'; END IF;
  v_blocked := false;
  BEGIN
    PERFORM public.assistant_action_command_v1('confirm','[CRM_TEST_ONLY] operator',v_id,NULL,NULL,
      repeat('0',32));
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Wrong preview hash confirmed'; END IF;
  v_confirm := public.assistant_action_command_v1('confirm','[CRM_TEST_ONLY] operator',v_id,NULL,NULL,
    v_preview->>'previewHash');
  IF v_confirm->>'status' <> 'confirmed' OR
     EXISTS (SELECT 1 FROM public.actions WHERE person_id=928901) THEN
    RAISE EXCEPTION 'Confirmation wrote business data';
  END IF;
  v_result := public.assistant_action_command_v1('execute','[CRM_TEST_ONLY] operator',v_id);
  v_action_id := (v_result->>'actionId')::bigint;
  v_replay := public.assistant_action_command_v1('execute','[CRM_TEST_ONLY] operator',v_id);
  IF v_result->>'status' <> 'executed' OR v_result->>'replayed' <> 'false' OR
     v_replay->>'replayed' <> 'true' OR
     (v_replay->>'actionId')::bigint <> v_action_id OR
     (SELECT count(*) FROM public.actions WHERE person_id=928901) <> 1 OR
     NOT EXISTS (SELECT 1 FROM public.actions WHERE id=v_action_id
       AND source='ai_assistant' AND status='open'
       AND confirmed_by_uid='[CRM_TEST_ONLY] operator' AND confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Execution or retry was not exactly once';
  END IF;
  v_plan := public.assistant_action_command_v1('plan','[CRM_TEST_ONLY] operator',NULL,928901,
    '{"action_type":"followup","title":"[CRM_TEST_ONLY] 完成回访","priority":"medium"}'::jsonb,NULL);
  v_blocked := false;
  BEGIN
    PERFORM public.assistant_action_command_v1('preview','[CRM_TEST_ONLY] operator',
      (v_plan->>'commandId')::uuid);
  EXCEPTION WHEN unique_violation THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Duplicate Action preview was accepted'; END IF;
  RAISE EXCEPTION 'ACTION_COMMAND_VALIDATED_ROLLED_BACK';
END;
$test$;
