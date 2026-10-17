-- PC32 recruit stage transaction audit. Reuses registered fictional candidate 19.
-- The outer exception rolls back all stage/milestone writes.
DO $test$
DECLARE
  v_candidate bigint := 19;
  v_person bigint := 784;
  v_actor text := '[CRM_TEST_ONLY] PC32 recruit actor';
  v_before public.recruit_candidates%ROWTYPE;
  v_milestones integer;
  v_result jsonb;
  v_new_at timestamptz;
  v_blocked boolean;
  v_checks integer := 0;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.crm_test_records r
      WHERE r.batch_key='crm_test_main_v1' AND r.record_table='recruit_candidates'
        AND r.record_id=v_candidate::text) THEN
    RAISE EXCEPTION 'PC32 recruit fixture is not registered';
  END IF;
  SELECT * INTO v_before FROM public.recruit_candidates
    WHERE id=v_candidate AND person_id=v_person AND deleted_at IS NULL;
  IF NOT FOUND OR v_before.stage<>'新增人才' THEN
    RAISE EXCEPTION 'PC32 recruit fixture changed';
  END IF;
  SELECT count(*) INTO v_milestones FROM public.recruit_milestones
    WHERE candidate_id=v_candidate;
  BEGIN
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_recruit_candidate_transition_v1(v_actor,v_candidate,783,
        v_before.updated_at,'互动暖客','【系统测试·勿联系】错误人物',v_actor);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Recruit candidate not found' THEN v_blocked:=true;
      ELSE RAISE; END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 cross-Person recruit transition accepted'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      v_result:=public.crm_recruit_candidate_transition_v1(v_actor,v_candidate,v_person,
        v_before.updated_at,'互动暖客','【系统测试·勿联系】故障模拟',v_actor);
      IF v_result->>'changed'<>'true' OR
         (SELECT count(*) FROM public.recruit_milestones WHERE candidate_id=v_candidate)<>v_milestones+1
      THEN RAISE EXCEPTION 'PC32 recruit transition did not write both rows'; END IF;
      RAISE EXCEPTION 'PC32 injected post-milestone failure' USING ERRCODE='P32R1';
    EXCEPTION WHEN SQLSTATE 'P32R1' THEN NULL;
    END;
    IF EXISTS(SELECT 1 FROM public.recruit_candidates
        WHERE id=v_candidate AND (stage IS DISTINCT FROM v_before.stage
          OR updated_at IS DISTINCT FROM v_before.updated_at)) OR
       (SELECT count(*) FROM public.recruit_milestones WHERE candidate_id=v_candidate)<>v_milestones
    THEN RAISE EXCEPTION 'PC32 recruit fault left stage or milestone'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_recruit_candidate_transition_v1(v_actor,v_candidate,v_person,
      v_before.updated_at,'互动暖客','【系统测试·勿联系】虚构阶段推进',v_actor);
    v_new_at:=(v_result->>'updatedAt')::timestamptz;
    IF v_result->>'ok'<>'true' OR v_result->>'changed'<>'true' OR
       NOT EXISTS(SELECT 1 FROM public.recruit_candidates
         WHERE id=v_candidate AND stage='互动暖客' AND updated_at=v_new_at) OR
       (SELECT count(*) FROM public.recruit_milestones
         WHERE candidate_id=v_candidate AND from_stage='新增人才' AND to_stage='互动暖客')<>1
    THEN RAISE EXCEPTION 'PC32 recruit first stage and milestone mismatch'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_recruit_candidate_transition_v1(v_actor,v_candidate,v_person,
      v_before.updated_at,'互动暖客','【系统测试·勿联系】重复请求',v_actor);
    IF v_result->>'conflict'<>'true' OR v_result->>'code'<>'RECRUIT_CONFLICT' OR
       (SELECT count(*) FROM public.recruit_milestones WHERE candidate_id=v_candidate)<>v_milestones+1
    THEN RAISE EXCEPTION 'PC32 stale recruit retry was not clearly rejected'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_recruit_candidate_transition_v1(v_actor,v_candidate,v_person,
      v_new_at,'互动暖客','【系统测试·勿联系】同阶段重试',v_actor);
    IF v_result->>'ok'<>'true' OR v_result->>'changed'<>'false' OR
       (SELECT count(*) FROM public.recruit_milestones WHERE candidate_id=v_candidate)<>v_milestones+1
    THEN RAISE EXCEPTION 'PC32 same-stage recruit replay duplicated milestone'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_recruit_candidate_transition_v1(v_actor,v_candidate,v_person,
        v_new_at,'非法阶段','【系统测试·勿联系】坏阶段',v_actor);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Invalid recruit stage transition' THEN v_blocked:=true;
      ELSE RAISE; END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 invalid recruit stage accepted'; END IF;
    v_checks:=v_checks+1;
    RAISE EXCEPTION 'PC32_RECRUIT_TEST_ROLLBACK' USING ERRCODE='P32R0';
  EXCEPTION WHEN SQLSTATE 'P32R0' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.recruit_candidates WHERE id=v_candidate
      AND (stage IS DISTINCT FROM v_before.stage
        OR updated_at IS DISTINCT FROM v_before.updated_at)) OR
     (SELECT count(*) FROM public.recruit_milestones WHERE candidate_id=v_candidate)<>v_milestones
  THEN RAISE EXCEPTION 'PC32 recruit fixture leaked after rollback'; END IF;
  RAISE NOTICE 'PC32 recruit stage passed % checks and rolled back',v_checks;
END $test$;
