-- Run only with a privileged test connection. Marked fixtures are removed in
-- this single statement; any assertion error rolls the whole statement back.
DO $test$
DECLARE
  v_customer_a integer := -93000101;
  v_customer_b integer := -93000102;
  v_candidate bigint := -93000201;
  v_person_a bigint;
  v_person_b bigint;
  v_link bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.customers WHERE "Id" IN (v_customer_a, v_customer_b))
     OR EXISTS (SELECT 1 FROM public.recruit_candidates WHERE id = v_candidate)
     OR EXISTS (SELECT 1 FROM public.persons
                WHERE legacy_customer_id IN (v_customer_a, v_customer_b)) THEN
    RAISE EXCEPTION 'CRM_TEST_ONLY fixture IDs already exist';
  END IF;

  INSERT INTO public.customers ("Id", customer_name) VALUES
    (v_customer_a, '[CRM_TEST_ONLY] candidate person A'),
    (v_customer_b, '[CRM_TEST_ONLY] candidate person B');
  INSERT INTO public.recruit_candidates
    (id, customer_id, stage, motivation, concerns, potential_score, career_plan, profile)
  VALUES
    (v_candidate, v_customer_a, '新增人才', '[CRM_TEST_ONLY] motivation',
     '[CRM_TEST_ONLY] concern', 60, '[CRM_TEST_ONLY] plan',
     '{"test":"[CRM_TEST_ONLY]"}'::jsonb);

  SELECT id INTO v_person_a FROM public.persons
  WHERE legacy_customer_id = v_customer_a;
  SELECT person_id INTO v_link FROM public.recruit_candidates WHERE id = v_candidate;
  IF v_person_a IS NULL OR v_link IS DISTINCT FROM v_person_a THEN
    RAISE EXCEPTION 'Candidate insert did not create and link Person A';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.v_recruit_candidates
                 WHERE candidate_id = v_candidate AND person_id = v_person_a
                   AND stage = '新增人才' AND motivation = '[CRM_TEST_ONLY] motivation'
                   AND concerns = '[CRM_TEST_ONLY] concern' AND potential_score = 60
                   AND career_plan = '[CRM_TEST_ONLY] plan'
                   AND profile ->> 'test' = '[CRM_TEST_ONLY]') THEN
    RAISE EXCEPTION 'Legacy candidate view lost profile fields or Person link';
  END IF;

  UPDATE public.recruit_candidates SET customer_id = v_customer_b
  WHERE id = v_candidate;
  SELECT id INTO v_person_b FROM public.persons
  WHERE legacy_customer_id = v_customer_b;
  SELECT person_id INTO v_link FROM public.recruit_candidates WHERE id = v_candidate;
  IF v_person_b IS NULL OR v_link IS DISTINCT FROM v_person_b THEN
    RAISE EXCEPTION 'Customer reassignment did not resolve Person B';
  END IF;

  BEGIN
    UPDATE public.recruit_candidates SET person_id = v_person_a
    WHERE id = v_candidate;
    RAISE EXCEPTION 'Unrelated Person assignment was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Candidate Person cannot be changed independently' THEN RAISE; END IF;
  END;

  DELETE FROM public.recruit_candidates WHERE id = v_candidate;
  DELETE FROM public.persons
  WHERE legacy_customer_id IN (v_customer_a, v_customer_b)
    AND display_name LIKE '[CRM_TEST_ONLY] candidate person %';
  DELETE FROM public.customers WHERE "Id" IN (v_customer_a, v_customer_b);
  IF EXISTS (SELECT 1 FROM public.persons
             WHERE legacy_customer_id IN (v_customer_a, v_customer_b)) THEN
    RAISE EXCEPTION 'CRM_TEST_ONLY Person fixture cleanup failed';
  END IF;
END;
$test$;
