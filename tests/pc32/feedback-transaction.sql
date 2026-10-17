-- PC32 feedback and actual Outcome transaction audit.
-- Only registered fictional AI/Action sources are touched; all changes roll back.
DO $test$
DECLARE
  v_actor text := '[CRM_TEST_ONLY] PC32 feedback actor';
  v_other text := '[CRM_TEST_ONLY] PC32 different actor';
  v_ai_result_id bigint;
  v_decision_key uuid := '00000000-0000-4000-8000-000000032901';
  v_decision_fail uuid := '00000000-0000-4000-8000-000000032902';
  v_outcome_key uuid := '00000000-0000-4000-8000-000000032903';
  v_outcome_fail uuid := '00000000-0000-4000-8000-000000032904';
  v_at timestamptz := now();
  v_first jsonb;
  v_next jsonb;
  v_blocked boolean;
  v_checks integer := 0;
BEGIN
  SELECT a.id INTO v_ai_result_id
  FROM public.crm_test_records r
  JOIN public.ai_results a ON a.id::text=r.record_id
  JOIN public.ai_tasks t ON t.id=a.task_id
  WHERE r.batch_key='crm_test_main_v1' AND r.record_table='ai_results'
    AND t.status='completed'
  ORDER BY a.id LIMIT 1;
  IF v_ai_result_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r WHERE r.batch_key='crm_test_main_v1'
      AND r.record_table='actions' AND r.record_id='6'
  ) OR NOT EXISTS(SELECT 1 FROM public.actions WHERE id=6 AND person_id=783 AND status='open')
    THEN RAISE EXCEPTION 'PC32 registered AI/Action source unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.ai_result_feedback_events WHERE id IN(v_decision_key,v_decision_fail))
    OR EXISTS(SELECT 1 FROM public.outcomes WHERE idempotency_key IN(v_outcome_key,v_outcome_fail))
    THEN RAISE EXCEPTION 'PC32 fixture idempotency keys occupied'; END IF;
  BEGIN
    UPDATE public.actions SET status='completed',completed_at=v_at,completed_by_uid=v_actor
      WHERE id=6 AND person_id=783 AND status='open';
    v_first:=public.crm_ai_experience_decide_v1(v_actor,v_decision_key,v_ai_result_id,
      'accepted',NULL,NULL);
    IF v_first->>'replayed'<>'false' OR
      (SELECT count(*) FROM public.ai_result_feedback_events WHERE id=v_decision_key)<>1
      THEN RAISE EXCEPTION 'PC32 first feedback did not write once'; END IF;
    v_checks:=v_checks+1;
    v_next:=public.crm_ai_experience_decide_v1(v_actor,v_decision_key,v_ai_result_id,
      'accepted',NULL,NULL);
    IF v_next->>'replayed'<>'true' OR v_next->>'eventId'<>v_first->>'eventId'
      THEN RAISE EXCEPTION 'PC32 feedback replay did not return original'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_ai_experience_decide_v1(v_other,v_decision_key,v_ai_result_id,
        'accepted',NULL,NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 feedback accepted changed actor'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_ai_experience_decide_v1(v_actor,v_decision_key,v_ai_result_id,
        'rejected','【系统测试·勿联系】 changed',NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 feedback accepted changed payload'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      PERFORM public.crm_ai_experience_decide_v1(v_actor,v_decision_fail,v_ai_result_id,
        'accepted',NULL,NULL);
      RAISE EXCEPTION 'PC32 injected feedback failure' USING ERRCODE='P32F1';
    EXCEPTION WHEN SQLSTATE 'P32F1' THEN NULL;
    END;
    IF EXISTS(SELECT 1 FROM public.ai_result_feedback_events WHERE id=v_decision_fail)
      THEN RAISE EXCEPTION 'PC32 feedback failure left event'; END IF;
    v_next:=public.crm_ai_experience_decide_v1(v_actor,v_decision_fail,v_ai_result_id,
      'accepted',NULL,NULL);
    IF v_next->>'replayed'<>'false' THEN RAISE EXCEPTION 'PC32 feedback retry failed'; END IF;
    v_checks:=v_checks+1;
    v_first:=public.crm_ai_experience_outcome_v1(v_actor,v_outcome_key,'action',6,
      v_ai_result_id,'【系统测试·勿联系】虚构实际结果',v_at,
      '【系统测试·勿联系】虚构证据');
    IF v_first->>'replayed'<>'false' OR
      (SELECT count(*) FROM public.outcomes WHERE idempotency_key=v_outcome_key)<>1
      THEN RAISE EXCEPTION 'PC32 first Outcome did not write once'; END IF;
    v_checks:=v_checks+1;
    v_next:=public.crm_ai_experience_outcome_v1(v_actor,v_outcome_key,'action',6,
      v_ai_result_id,'【系统测试·勿联系】虚构实际结果',v_at,
      '【系统测试·勿联系】虚构证据');
    IF v_next->>'replayed'<>'true' OR v_next->>'outcomeId'<>v_first->>'outcomeId'
      THEN RAISE EXCEPTION 'PC32 Outcome replay did not return original'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_ai_experience_outcome_v1(v_other,v_outcome_key,'action',6,
        v_ai_result_id,'【系统测试·勿联系】虚构实际结果',v_at,
        '【系统测试·勿联系】虚构证据');
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 Outcome accepted changed actor'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_ai_experience_outcome_v1(v_actor,v_outcome_key,'action',6,
        v_ai_result_id,'【系统测试·勿联系】被改写',v_at,
        '【系统测试·勿联系】虚构证据');
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 Outcome accepted changed payload'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      PERFORM public.crm_ai_experience_outcome_v1(v_actor,v_outcome_fail,'action',6,
        v_ai_result_id,'【系统测试·勿联系】故障结果',v_at,
        '【系统测试·勿联系】虚构证据');
      RAISE EXCEPTION 'PC32 injected Outcome failure' USING ERRCODE='P32F2';
    EXCEPTION WHEN SQLSTATE 'P32F2' THEN NULL;
    END;
    IF EXISTS(SELECT 1 FROM public.outcomes WHERE idempotency_key=v_outcome_fail)
      THEN RAISE EXCEPTION 'PC32 Outcome failure left row'; END IF;
    v_next:=public.crm_ai_experience_outcome_v1(v_actor,v_outcome_fail,'action',6,
      v_ai_result_id,'【系统测试·勿联系】故障结果',v_at,
      '【系统测试·勿联系】虚构证据');
    IF v_next->>'replayed'<>'false' THEN RAISE EXCEPTION 'PC32 Outcome retry failed'; END IF;
    v_checks:=v_checks+1;
    RAISE EXCEPTION 'PC32_FEEDBACK_TEST_ROLLBACK' USING ERRCODE='P32F0';
  EXCEPTION WHEN SQLSTATE 'P32F0' THEN NULL;
  END;
  IF NOT EXISTS(SELECT 1 FROM public.actions WHERE id=6 AND person_id=783 AND status='open')
    OR EXISTS(SELECT 1 FROM public.ai_result_feedback_events WHERE id IN(v_decision_key,v_decision_fail))
    OR EXISTS(SELECT 1 FROM public.outcomes WHERE idempotency_key IN(v_outcome_key,v_outcome_fail))
    THEN RAISE EXCEPTION 'PC32 feedback fixture leaked after rollback'; END IF;
  RAISE NOTICE 'PC32 feedback/Outcome passed % checks and rolled back',v_checks;
END $test$;
