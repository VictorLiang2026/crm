-- PC28: only registered fictional Person #786 / candidate #20 / follow-up #3.
-- The nested exception block rolls back every command and business mutation.
BEGIN;
SET LOCAL ROLE service_role;
DO $pc28$
DECLARE
  v_actor text := 'pc28-rollback-only-test';
  v_key uuid := gen_random_uuid();
  v_plan jsonb;
  v_preview jsonb;
  v_result jsonb;
  v_cmd uuid;
  v_batch uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crm_test_records
      WHERE batch_key='crm_test_main_v1' AND record_table='persons' AND record_id='786') OR
     NOT EXISTS (SELECT 1 FROM public.crm_test_records
      WHERE batch_key='crm_test_main_v1' AND record_table='recruit_candidates' AND record_id='20') OR
     NOT EXISTS (SELECT 1 FROM public.recruit_candidates
      WHERE id=20 AND person_id=786 AND customer_id IS NULL AND deleted_at IS NULL) OR
     NOT EXISTS (SELECT 1 FROM public.recruit_followups
      WHERE id=3 AND candidate_id=20 AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Expected registered fictional PC28 fixture';
  END IF;
  BEGIN
    v_plan := public.assistant_recruit_delete_command_v1('plan',v_actor,NULL,
      v_key,786,20,'【系统测试·勿联系】删除一名增员候选人','【系统测试·勿联系】虚构人物',NULL);
    v_cmd := (v_plan->>'commandId')::uuid;
    IF v_cmd IS NULL THEN RAISE EXCEPTION 'Plan has no command ID'; END IF;
    BEGIN
      PERFORM public.assistant_recruit_delete_command_v1('plan','different-actor',NULL,
        v_key,786,20,'【系统测试·勿联系】删除一名增员候选人','【系统测试·勿联系】虚构人物',NULL);
      RAISE EXCEPTION 'Other actor reused key';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    BEGIN
      PERFORM public.assistant_recruit_delete_command_v1('plan',v_actor,NULL,
        v_key,786,20,'【系统测试·勿联系】修改请求','【系统测试·勿联系】虚构人物',NULL);
      RAISE EXCEPTION 'Modified request reused key';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    BEGIN
      PERFORM public.assistant_recruit_delete_command_v1('execute',v_actor,v_cmd);
      RAISE EXCEPTION 'Unconfirmed command executed';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    v_preview := public.assistant_recruit_delete_command_v1('preview',v_actor,v_cmd);
    IF (v_preview->'preview'->>'followupCount')::int <> 1 OR
       (v_preview->'preview'->'followupIds')::text <> '[3]' THEN
      RAISE EXCEPTION 'Preview impact differs from fictional fixture';
    END IF;
    BEGIN
      PERFORM public.assistant_recruit_delete_command_v1('confirm',v_actor,v_cmd,
        NULL,NULL,NULL,NULL,NULL,'00000000000000000000000000000000');
      RAISE EXCEPTION 'Forged preview hash accepted';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
    PERFORM public.assistant_recruit_delete_command_v1('confirm',v_actor,v_cmd,
      NULL,NULL,NULL,NULL,NULL,v_preview->>'previewHash');
    v_result := public.assistant_recruit_delete_command_v1('execute',v_actor,v_cmd);
    v_batch := (v_result->'result'->>'batchId')::uuid;
    IF v_batch IS NULL OR (v_result->'result'->>'followupCount')::int <> 1 OR
       NOT EXISTS (SELECT 1 FROM public.recruit_candidates
         WHERE id=20 AND delete_batch_id=v_batch AND deleted_at IS NOT NULL) OR
       NOT EXISTS (SELECT 1 FROM public.recruit_followups
         WHERE id=3 AND delete_batch_id=v_batch AND deleted_at IS NOT NULL) OR
       NOT EXISTS (SELECT 1 FROM public.persons WHERE id=786 AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Atomic delete impact was not exact';
    END IF;
    v_result := public.assistant_recruit_delete_command_v1('execute',v_actor,v_cmd);
    IF v_result->>'replayed' <> 'true' OR (v_result->'result'->>'batchId')::uuid <> v_batch THEN
      RAISE EXCEPTION 'Replay did not reuse the original batch';
    END IF;
    v_result := public.assistant_recruit_delete_command_v1('plan',v_actor,NULL,
      v_key,786,20,'【系统测试·勿联系】删除一名增员候选人','【系统测试·勿联系】虚构人物',NULL);
    IF v_result->>'replayed' <> 'true' OR (v_result->'result'->>'batchId')::uuid <> v_batch THEN
      RAISE EXCEPTION 'Plan retry after delete did not reuse the original batch';
    END IF;
    RAISE EXCEPTION 'intentional rollback' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    IF EXISTS (SELECT 1 FROM public.assistant_recruit_delete_commands WHERE id=v_cmd) OR
       NOT EXISTS (SELECT 1 FROM public.recruit_candidates WHERE id=20 AND deleted_at IS NULL) OR
       NOT EXISTS (SELECT 1 FROM public.recruit_followups WHERE id=3 AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Rollback failed';
    END IF;
  END;
END;
$pc28$;
ROLLBACK;
