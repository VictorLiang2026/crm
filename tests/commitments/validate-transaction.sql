-- Execute as service_role. All fixtures use negative IDs and are rolled back.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.persons WHERE id IN (-929002, -929001))
     OR EXISTS (SELECT 1 FROM public.interactions WHERE id IN (-929012, -929011))
     OR EXISTS (SELECT 1 FROM public.commitments WHERE id BETWEEN -929099 AND -929001) THEN
    RAISE EXCEPTION 'Commitment test fixture IDs are already occupied';
  END IF;
END $guard$;

INSERT INTO public.persons (id, display_name, name_key)
VALUES (-929001, 'COMMITMENT_TEST_PERSON_A', 'commitment_test_person_a'),
       (-929002, 'COMMITMENT_TEST_PERSON_B', 'commitment_test_person_b');
INSERT INTO public.interactions
  (id, person_id, interaction_type, interaction_at, summary, source_type, created_by_uid)
VALUES (-929011, -929001, 'test', now(), 'COMMITMENT_TEST_INTERACTION_A', 'manual', 'commitment-test'),
       (-929012, -929002, 'test', now(), 'COMMITMENT_TEST_INTERACTION_B', 'manual', 'commitment-test');

INSERT INTO public.commitments
  (id, person_id, interaction_id, commitment_type, content, due_at, source, created_by_uid)
VALUES (-929021, -929001, -929011, 'I_PROMISED', 'COMMITMENT_TEST_OVERDUE', now() - interval '1 day', 'manual', 'commitment-test'),
       (-929022, -929001, -929011, 'THEY_PROMISED', 'COMMITMENT_TEST_SOON', now() + interval '1 day', 'manual', 'commitment-test'),
       (-929023, -929001, NULL, 'MUTUAL', 'COMMITMENT_TEST_UNSCHEDULED', NULL, 'manual', 'commitment-test');

DO $checks$ BEGIN
  IF (SELECT count(*) FROM public.commitments
      WHERE person_id = -929001 AND status = 'open') <> 3 THEN
    RAISE EXCEPTION 'three commitment types were not saved';
  END IF;
  BEGIN
    INSERT INTO public.commitments
      (id, person_id, interaction_id, commitment_type, content, source, created_by_uid)
    VALUES (-929024, -929001, -929012, 'I_PROMISED', 'COMMITMENT_TEST_WRONG_PERSON', 'manual', 'commitment-test');
    RAISE EXCEPTION 'wrong-Person interaction unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.commitments
      (id, person_id, commitment_type, content, source, created_by_uid)
    VALUES (-929025, -929001, 'I_PROMISED', 'COMMITMENT_TEST_UNCONFIRMED_AI', 'ai_results', 'commitment-test');
    RAISE EXCEPTION 'unconfirmed AI commitment unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.commitments
      (id, person_id, commitment_type, content, source, created_by_uid)
    VALUES (-929026, -929001, 'NOT_A_TYPE', 'COMMITMENT_TEST_BAD_TYPE', 'manual', 'commitment-test');
    RAISE EXCEPTION 'invalid commitment type unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.commitments WHERE id BETWEEN -929026 AND -929021) <> 3 THEN
    RAISE EXCEPTION 'invalid commitments were persisted';
  END IF;
END $checks$;

UPDATE public.commitments SET status = 'completed', completed_at = now(),
  completed_by_uid = 'commitment-test' WHERE id = -929021;
DO $checks$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commitments WHERE id = -929021
                 AND status = 'completed' AND completed_at IS NOT NULL
                 AND completed_by_uid = 'commitment-test') THEN
    RAISE EXCEPTION 'completion did not persist';
  END IF;
END $checks$;
ROLLBACK;
