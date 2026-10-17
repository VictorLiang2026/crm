-- Service-role live test. Reuses registered fictional AI sources only.
-- Every new business/audit row is inside the rollback subtransaction below.
-- Outcomes/Learning are registered as derived; feedback audit events retain
-- their registered ai_result_id and marker (not a registry-allowlisted table).
DO $test$
DECLARE
  v_ids bigint[];
  v_payload jsonb;
  v_changed jsonb;
  v_result jsonb;
  v_learning bigint;
  v_outcome bigint;
  v_rolled_back_id bigint;
  v_key uuid := '00000000-0000-4000-8000-000000032001';
  v_failure_key uuid := '00000000-0000-4000-8000-000000032002';
  v_actor text := '[CRM_TEST_ONLY] PC32 actor A';
  v_provenance jsonb;
  v_field text;
  v_mode integer;
  v_id bigint;
  v_blocked boolean;
  v_checks integer := 0;
BEGIN
  BEGIN
    SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
      SELECT a.id FROM public.crm_test_records r
      JOIN public.ai_results a ON a.id::text=r.record_id
      JOIN public.ai_tasks t ON t.id=a.task_id
      WHERE r.batch_key='crm_test_main_v1' AND r.record_table='ai_results' AND t.status='completed'
      ORDER BY a.id LIMIT 3
    ) src;
    IF COALESCE(cardinality(v_ids),0)<3 THEN RAISE EXCEPTION 'Need three registered fictional AI sources'; END IF;
    IF EXISTS(SELECT 1 FROM public.learnings WHERE candidate_key IN(v_key,v_failure_key)) THEN
      RAISE EXCEPTION 'PC32 fixture key occupied';
    END IF;
    v_payload := jsonb_build_object('sourceResultIds',jsonb_build_array(v_ids[1],v_ids[2]),
      'primaryResultId',v_ids[1],'situation','【系统测试·勿联系】PC32 situation',
      'recommendation','【系统测试·勿联系】PC32 recommendation','actualAction','【系统测试·勿联系】PC32 action',
      'learning','【系统测试·勿联系】PC32 learning','scope','PC32 fictional cohort',
      'confidence',0.7,'counterexampleIds',jsonb_build_array(v_ids[2]));

    -- Validation failure before any candidate write.
    v_blocked := false;
    BEGIN
      PERFORM public.crm_ai_experience_learning_v1(v_actor,v_key,v_payload||'{"confidence":2}'::jsonb);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked OR EXISTS(SELECT 1 FROM public.learnings WHERE candidate_key=v_key) THEN
      RAISE EXCEPTION 'PC32 invalid request wrote a candidate';
    END IF;
    v_checks := v_checks+1;

    FOREACH v_id IN ARRAY v_ids[1:2] LOOP
      PERFORM public.crm_ai_experience_decide_v1(v_actor,gen_random_uuid(),v_id,
        'accepted','【系统测试·勿联系】PC32 rollback-only decision',NULL);
      INSERT INTO public.outcomes(ai_result_id,outcome_type,result,occurred_at,evidence,recorded_by_uid)
        VALUES(v_id,'actual_result','【系统测试·勿联系】PC32 fictional result',now(),
          '【系统测试·勿联系】PC32 rollback-only evidence',v_actor) RETURNING id INTO v_outcome;
      IF NOT EXISTS(SELECT 1 FROM public.crm_test_records WHERE batch_key='crm_test_main_v1'
        AND record_table='outcomes' AND record_id=v_outcome::text AND origin='derived') THEN
        RAISE EXCEPTION 'PC32 Outcome missing automatic derived registration';
      END IF;
    END LOOP;
    v_result := public.crm_ai_experience_learning_v1(v_actor,v_key,v_payload);
    v_learning := (v_result->>'learningId')::bigint;
    IF v_result->>'replayed'<>'false' OR v_result->>'confirmed'<>'false' OR
       (v_result->>'sampleSize')::integer<>2 THEN RAISE EXCEPTION 'PC32 first create contract changed'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.crm_test_records WHERE batch_key='crm_test_main_v1'
      AND record_table='learnings' AND record_id=v_learning::text AND origin='derived') THEN
      RAISE EXCEPTION 'PC32 Learning missing automatic derived registration';
    END IF;
    v_checks := v_checks+1;
    SELECT provenance INTO v_provenance FROM public.learnings WHERE id=v_learning;

    -- New audit and historical PC29 shape must both compare every field.
    FOR v_mode IN 1..2 LOOP
      IF v_mode=2 THEN
        UPDATE public.learnings SET provenance=provenance-'requestPayload'-'requestVersion' WHERE id=v_learning;
      END IF;
      v_result := public.crm_ai_experience_learning_v1(v_actor,v_key,v_payload);
      IF v_result->>'replayed'<>'true' OR (v_result->>'learningId')::bigint<>v_learning OR
         (SELECT count(*) FROM public.learnings WHERE candidate_key=v_key)<>1 THEN
        RAISE EXCEPTION 'PC32 replay duplicated or changed candidate';
      END IF;
      v_checks := v_checks+1;
      v_blocked := false;
      BEGIN
        PERFORM public.crm_ai_experience_learning_v1('[CRM_TEST_ONLY] PC32 actor B',v_key,v_payload);
      EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
      END;
      IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 replay accepted a different actor'; END IF;
      v_checks := v_checks+1;
      FOREACH v_field IN ARRAY ARRAY['sourceResultIds','primaryResultId','situation','recommendation',
        'actualAction','learning','scope','confidence','counterexampleIds'] LOOP
        v_changed := jsonb_set(v_payload,ARRAY[v_field],CASE v_field
          WHEN 'sourceResultIds' THEN to_jsonb(v_ids)
          WHEN 'primaryResultId' THEN to_jsonb(v_ids[2])
          WHEN 'confidence' THEN '0.8'::jsonb
          WHEN 'counterexampleIds' THEN '[]'::jsonb
          ELSE to_jsonb((v_payload->>v_field)||' changed') END);
        v_blocked := false;
        BEGIN
          PERFORM public.crm_ai_experience_learning_v1(v_actor,v_key,v_changed);
        EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
        END;
        IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 replay accepted changed field % (mode %)',v_field,v_mode; END IF;
        v_checks := v_checks+1;
      END LOOP;
      v_changed := v_payload||jsonb_build_object('sourceResultIds',jsonb_build_array(v_ids[2],v_ids[1]),
        'situation',' '||(v_payload->>'situation')||' ');
      v_result := public.crm_ai_experience_learning_v1(v_actor,v_key,v_changed);
      IF v_result->>'replayed'<>'true' THEN RAISE EXCEPTION 'PC32 normalized replay failed'; END IF;
      v_checks := v_checks+1;
    END LOOP;
    UPDATE public.learnings SET provenance=v_provenance-'actorUid' WHERE id=v_learning;
    v_blocked := false;
    BEGIN
      PERFORM public.crm_ai_experience_learning_v1(v_actor,v_key,v_payload);
    EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 missing audit guessed actor'; END IF;
    UPDATE public.learnings SET provenance=v_provenance WHERE id=v_learning;
    v_checks := v_checks+1;

    -- Existing separate human-confirmation contract remains authoritative.
    PERFORM public.crm_ai_experience_confirm_learning_v1(v_actor,v_learning,'【系统测试·勿联系】PC32 human review');
    v_result := public.crm_ai_experience_learning_v1(v_actor,v_key,v_payload);
    IF (v_result->>'learningId')::bigint<>v_learning OR NOT EXISTS(
      SELECT 1 FROM public.learnings WHERE id=v_learning AND confirmed AND confirmed_by_uid=v_actor
    ) THEN RAISE EXCEPTION 'PC32 replay altered human confirmation'; END IF;
    v_checks := v_checks+1;

    -- Candidate fields and source audit are a single INSERT. Inject failure
    -- after that INSERT and derived registration, before the enclosing commit.
    BEGIN
      v_result := public.crm_ai_experience_learning_v1(v_actor,v_failure_key,v_payload);
      v_rolled_back_id := (v_result->>'learningId')::bigint;
      IF NOT EXISTS(SELECT 1 FROM public.crm_test_records WHERE record_table='learnings'
        AND record_id=v_rolled_back_id::text AND origin='derived') THEN
        RAISE EXCEPTION 'PC32 injected candidate missing automatic registration';
      END IF;
      RAISE EXCEPTION 'PC32 injected post-write failure' USING ERRCODE='P3201';
    EXCEPTION WHEN SQLSTATE 'P3201' THEN NULL;
    END;
    IF EXISTS(SELECT 1 FROM public.learnings WHERE candidate_key=v_failure_key) OR EXISTS(
      SELECT 1 FROM public.crm_test_records WHERE record_table='learnings' AND record_id=v_rolled_back_id::text
    ) THEN RAISE EXCEPTION 'PC32 post-write failure left partial records'; END IF;
    v_result := public.crm_ai_experience_learning_v1(v_actor,v_failure_key,v_payload);
    IF v_result->>'replayed'<>'false' THEN RAISE EXCEPTION 'PC32 rollback retry did not create once'; END IF;
    v_checks := v_checks+1;
    RAISE EXCEPTION 'PC32_TEST_ROLLBACK' USING ERRCODE='P3202';
  EXCEPTION WHEN SQLSTATE 'P3202' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.learnings WHERE candidate_key IN(v_key,v_failure_key)) OR EXISTS(
    SELECT 1 FROM public.crm_test_records WHERE record_table='learnings'
      AND record_id IN(v_learning::text,v_rolled_back_id::text)
  ) OR EXISTS(SELECT 1 FROM public.ai_result_feedback_events WHERE actor_uid=v_actor) OR EXISTS(
    SELECT 1 FROM public.outcomes WHERE recorded_by_uid=v_actor
  ) THEN RAISE EXCEPTION 'PC32 final rollback left fixture records'; END IF;
  RAISE NOTICE 'PC32 Learning transaction passed: % checks; all fixture rows rolled back',v_checks;
END;
$test$;
