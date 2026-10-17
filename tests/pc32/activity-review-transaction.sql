-- PC32 activity review: registered fictional Activity 11, service_role only.
-- Every new command and Outcome is enclosed in an outer rollback subtransaction.
DO $test$
DECLARE
  v_activity bigint := 11;
  v_actor text := '2102162853214060545';
  v_other text := '[CRM_TEST_ONLY] PC32 different activity actor';
  v_old_command uuid := 'ce61aceb-b79b-4798-a9aa-440bde1de6ee';
  v_key uuid := pg_catalog.gen_random_uuid();
  v_payload jsonb := jsonb_build_object(
    'outcomeType','activity_review',
    'result','【系统测试·勿联系】PC32 虚构活动复盘事务核验；未发生真实接触或业务成果。',
    'occurredAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  v_before_outcomes integer;
  v_before_commands integer;
  v_preview jsonb;
  v_result jsonb;
  v_outcome_id bigint;
  v_blocked boolean;
  v_checks integer := 0;
BEGIN
  IF current_user<>'service_role' OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r
    JOIN public.crm_test_batches b ON b.batch_key=r.batch_key
    WHERE b.created_by_uid=v_actor AND r.record_table='activities'
      AND r.record_id=v_activity::text AND r.batch_key='crm_test_main_v1')
    OR NOT EXISTS(SELECT 1 FROM public.activities
      WHERE id=v_activity AND status='reviewed' AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'PC32 registered fictional Activity unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_activity_review_commands WHERE id=v_key) THEN
    RAISE EXCEPTION 'PC32 generated activity key is occupied';
  END IF;
  SELECT count(*) INTO v_before_outcomes FROM public.outcomes WHERE activity_id=v_activity;
  SELECT count(*) INTO v_before_commands FROM public.crm_activity_review_commands
    WHERE activity_id=v_activity;
  v_result:=public.crm_activity_review_execute_v1(v_actor,v_old_command);
  IF v_result->>'replayed'<>'true' OR v_result->>'businessDataWritten'<>'false'
     OR (v_result->>'outcomeId')::bigint<>2 OR
     (SELECT count(*) FROM public.outcomes WHERE activity_id=v_activity)<>v_before_outcomes
  THEN RAISE EXCEPTION 'PC32 historical executed activity command did not replay safely'; END IF;
  v_checks:=v_checks+1;
  v_blocked:=false;
  BEGIN
    PERFORM public.crm_activity_review_execute_v1(v_other,v_old_command);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked:=true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 historical activity replay accepted another actor'; END IF;
  v_checks:=v_checks+1;
  BEGIN
    v_preview:=public.crm_activity_review_preview_v1(v_actor,v_key,'outcome',
      v_activity,NULL::bigint,NULL::integer,v_payload);
    IF v_preview->>'businessDataWritten'<>'false' OR
       (v_preview->>'previewId')::uuid<>v_key OR
       (SELECT count(*) FROM public.outcomes WHERE activity_id=v_activity)<>v_before_outcomes
    THEN RAISE EXCEPTION 'PC32 activity preview wrote business data'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      UPDATE public.activities SET updated_at=clock_timestamp() WHERE id=v_activity;
      v_blocked:=false;
      BEGIN
        PERFORM public.crm_activity_review_execute_v1(v_actor,v_key);
      EXCEPTION WHEN SQLSTATE '40001' THEN v_blocked:=true;
      END;
      IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 activity version conflict was accepted'; END IF;
      RAISE EXCEPTION 'PC32 rollback changed Activity' USING ERRCODE='P32A2';
    EXCEPTION WHEN SQLSTATE 'P32A2' THEN NULL;
    END;
    IF EXISTS(SELECT 1 FROM public.crm_activity_review_commands
      WHERE id=v_key AND executed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'PC32 version conflict executed command'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      v_result:=public.crm_activity_review_execute_v1(v_actor,v_key);
      IF v_result->>'replayed'<>'false' OR
         (SELECT count(*) FROM public.outcomes WHERE activity_id=v_activity)<>v_before_outcomes+1
      THEN RAISE EXCEPTION 'PC32 activity first execution failed'; END IF;
      RAISE EXCEPTION 'PC32 injected post-Outcome failure' USING ERRCODE='P32A1';
    EXCEPTION WHEN SQLSTATE 'P32A1' THEN NULL;
    END;
    IF (SELECT count(*) FROM public.outcomes WHERE activity_id=v_activity)<>v_before_outcomes OR
       EXISTS(SELECT 1 FROM public.crm_activity_review_commands
         WHERE id=v_key AND executed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'PC32 activity fault left partial records'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_activity_review_execute_v1(v_actor,v_key);
    v_outcome_id:=(v_result->>'outcomeId')::bigint;
    IF v_result->>'replayed'<>'false' OR v_outcome_id IS NULL OR
       NOT EXISTS(SELECT 1 FROM public.outcomes
         WHERE id=v_outcome_id AND activity_id=v_activity AND
           result LIKE '【系统测试·勿联系】%') OR
       (SELECT count(*) FROM public.outcomes WHERE activity_id=v_activity)<>v_before_outcomes+1
    THEN RAISE EXCEPTION 'PC32 activity retry failed to create exactly once'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_activity_review_execute_v1(v_actor,v_key);
    IF v_result->>'replayed'<>'true' OR v_result->>'businessDataWritten'<>'false' OR
       (v_result->>'outcomeId')::bigint<>v_outcome_id OR
       (SELECT count(*) FROM public.outcomes WHERE activity_id=v_activity)<>v_before_outcomes+1
    THEN RAISE EXCEPTION 'PC32 activity replay duplicated Outcome'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_activity_review_execute_v1(v_other,v_key);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 activity replay accepted different actor'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_activity_review_preview_v1(v_actor,v_key,'outcome',
        v_activity,NULL::bigint,NULL::integer,
        jsonb_set(v_payload,'{result}',to_jsonb('【系统测试·勿联系】changed'::text)));
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 activity key accepted changed payload'; END IF;
    v_checks:=v_checks+1;
    RAISE EXCEPTION 'PC32_ACTIVITY_TEST_ROLLBACK' USING ERRCODE='P32A0';
  EXCEPTION WHEN SQLSTATE 'P32A0' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.outcomes WHERE activity_id=v_activity)<>v_before_outcomes OR
     (SELECT count(*) FROM public.crm_activity_review_commands
       WHERE activity_id=v_activity)<>v_before_commands OR
     EXISTS(SELECT 1 FROM public.crm_activity_review_commands WHERE id=v_key)
  THEN RAISE EXCEPTION 'PC32 activity fixture leaked after outer rollback'; END IF;
  RAISE NOTICE 'PC32 activity review passed % checks; all new rows rolled back',v_checks;
END $test$;
