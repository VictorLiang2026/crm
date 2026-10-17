-- Run in session B only after pg_locks confirms the holder has acquired the key.
-- A bounded wait must reject without partially writing a candidate or registry.
DO $test$
DECLARE v_blocked boolean := false; v_ids bigint[]; v_payload jsonb;
BEGIN
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
    SELECT a.id FROM public.crm_test_records r JOIN public.ai_results a ON a.id::text=r.record_id
    JOIN public.ai_tasks t ON t.id=a.task_id
    WHERE r.batch_key='crm_test_main_v1' AND r.record_table='ai_results' AND t.status='completed'
    ORDER BY a.id LIMIT 2
  ) src;
  IF COALESCE(cardinality(v_ids),0)<>2 THEN RAISE EXCEPTION 'PC32 registered sources missing'; END IF;
  v_payload := jsonb_build_object('sourceResultIds',to_jsonb(v_ids),'primaryResultId',v_ids[1],
    'situation','【系统测试·勿联系】PC32 contention','learning','【系统测试·勿联系】PC32 contention',
    'scope','PC32 fictional contention');
  PERFORM set_config('lock_timeout','500ms',true);
  BEGIN
    PERFORM public.crm_ai_experience_learning_v1('[CRM_TEST_ONLY] PC32 actor A',
      '00000000-0000-4000-8000-000000032099',v_payload);
  EXCEPTION WHEN lock_not_available THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 same-key request did not wait for transaction lock'; END IF;
  IF EXISTS(SELECT 1 FROM public.learnings WHERE candidate_key='00000000-0000-4000-8000-000000032099') THEN
    RAISE EXCEPTION 'PC32 lock timeout left a candidate';
  END IF;
END;
$test$;
