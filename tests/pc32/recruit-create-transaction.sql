-- PC32 recruit creation: registered fictional Person 785 and customer 792 only.
-- Candidate, first milestone and derived ledger rows are rolled back.
DO $test$
DECLARE
  v_person bigint := 785;
  v_customer bigint := 792;
  v_name text := '【系统测试·勿联系】虚构快速记录乙';
  v_actor text := '[CRM_TEST_ONLY] PC32 recruit create actor';
  v_result jsonb;
  v_candidate bigint;
  v_failed_candidate bigint;
  v_blocked boolean;
  v_checks integer := 0;
BEGIN
  IF current_user<>'service_role' OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r
    WHERE r.batch_key='crm_test_main_v1' AND r.record_table='persons'
      AND r.record_id=v_person::text) OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r
    WHERE r.batch_key='crm_test_main_v1' AND r.record_table='customers'
      AND r.record_id=v_customer::text) OR NOT EXISTS(
    SELECT 1 FROM public.persons WHERE id=v_person AND display_name=v_name
      AND deleted_at IS NULL) OR EXISTS(
    SELECT 1 FROM public.recruit_candidates WHERE person_id=v_person AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'PC32 registered recruit create fixture changed'; END IF;
  BEGIN
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_recruit_candidate_create_v1(v_actor,v_person,
        '【系统测试·勿联系】错误选择','【系统测试·勿联系】测试');
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Selected Person changed; resolve identity again' THEN v_blocked:=true;
      ELSE RAISE; END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 recruit create accepted wrong Person name'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      v_result:=public.crm_recruit_candidate_create_v1(v_actor,v_person,v_name,
        '【系统测试·勿联系】测试');
      v_failed_candidate:=(v_result->>'id')::bigint;
      IF v_failed_candidate IS NULL OR NOT EXISTS(
        SELECT 1 FROM public.recruit_candidates c JOIN public.recruit_milestones m
          ON m.candidate_id=c.id
        WHERE c.id=v_failed_candidate AND c.person_id=v_person AND
          c.customer_id=v_customer AND c.stage='新增人才' AND
          m.to_stage='新增人才')
      THEN RAISE EXCEPTION 'PC32 recruit create did not write candidate and milestone'; END IF;
      RAISE EXCEPTION 'PC32 injected post-milestone create failure' USING ERRCODE='P32C1';
    EXCEPTION WHEN SQLSTATE 'P32C1' THEN NULL;
    END;
    IF EXISTS(SELECT 1 FROM public.recruit_candidates WHERE person_id=v_person) OR
       EXISTS(SELECT 1 FROM public.recruit_milestones WHERE candidate_id=v_failed_candidate) OR
       EXISTS(SELECT 1 FROM public.crm_test_records WHERE record_table='recruit_candidates'
         AND record_id=v_failed_candidate::text)
    THEN RAISE EXCEPTION 'PC32 recruit create fault left candidate, milestone or ledger'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_recruit_candidate_create_v1(v_actor,v_person,v_name,
      '【系统测试·勿联系】测试');
    v_candidate:=(v_result->>'id')::bigint;
    IF v_candidate IS NULL OR (v_result->>'personId')::bigint<>v_person OR
       (v_result->>'customerId')::bigint<>v_customer OR
       (SELECT count(*) FROM public.recruit_candidates
         WHERE person_id=v_person AND deleted_at IS NULL)<>1 OR
       (SELECT count(*) FROM public.recruit_milestones
         WHERE candidate_id=v_candidate AND to_stage='新增人才')<>1 OR
       NOT EXISTS(SELECT 1 FROM public.crm_test_records
         WHERE batch_key='crm_test_main_v1' AND record_table='recruit_candidates'
           AND record_id=v_candidate::text AND origin='derived')
    THEN RAISE EXCEPTION 'PC32 recruit create retry lacked atomic candidate or ledger'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_recruit_candidate_create_v1(v_actor,v_person,v_name,
        '【系统测试·勿联系】测试');
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Person already has an active recruit candidate' THEN v_blocked:=true;
      ELSE RAISE; END IF;
    END;
    IF NOT v_blocked OR
       (SELECT count(*) FROM public.recruit_candidates WHERE person_id=v_person
         AND deleted_at IS NULL)<>1 OR
       (SELECT count(*) FROM public.recruit_milestones WHERE candidate_id=v_candidate)<>1
    THEN RAISE EXCEPTION 'PC32 recruit duplicate request created a second candidate'; END IF;
    v_checks:=v_checks+1;
    RAISE EXCEPTION 'PC32_RECRUIT_CREATE_ROLLBACK' USING ERRCODE='P32C0';
  EXCEPTION WHEN SQLSTATE 'P32C0' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.recruit_candidates WHERE person_id=v_person) OR
     EXISTS(SELECT 1 FROM public.recruit_milestones
       WHERE candidate_id IN (v_candidate,v_failed_candidate)) OR
     EXISTS(SELECT 1 FROM public.crm_test_records
       WHERE record_table='recruit_candidates' AND
         record_id IN (v_candidate::text,v_failed_candidate::text))
  THEN RAISE EXCEPTION 'PC32 recruit create test leaked business or ledger rows'; END IF;
  RAISE NOTICE 'PC32 recruit create passed % checks; duplicate returns explicit conflict',v_checks;
END $test$;
