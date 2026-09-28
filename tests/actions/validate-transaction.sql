-- Execute as service_role. This test creates only marked fixtures and rolls back.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.persons WHERE id IN (-928002, -928001))
     OR EXISTS (SELECT 1 FROM public.opportunities WHERE id IN (-928032, -928031))
     OR EXISTS (SELECT 1 FROM public.interactions WHERE id IN (-928012, -928011))
     OR EXISTS (SELECT 1 FROM public.actions WHERE id BETWEEN -928099 AND -928001) THEN
    RAISE EXCEPTION 'Action test fixture IDs are already occupied';
  END IF;
END $guard$;

INSERT INTO public.persons (id, display_name, name_key, legacy_customer_id)
VALUES (-928001, 'ACTION_TEST_PERSON_A', 'action_test_person_a', -928101),
       (-928002, 'ACTION_TEST_PERSON_B', 'action_test_person_b', -928102);
INSERT INTO public.opportunities (id, customer_id, opportunity_type)
VALUES (-928031, -928101, 'ACTION_TEST_OPPORTUNITY_A'),
       (-928032, -928102, 'ACTION_TEST_OPPORTUNITY_B');
INSERT INTO public.interactions
  (id, person_id, interaction_type, interaction_at, summary, source_type, created_by_uid)
VALUES (-928011, -928001, 'test', now(), 'ACTION_TEST_INTERACTION_A', 'manual', 'action-test'),
       (-928012, -928002, 'test', now(), 'ACTION_TEST_INTERACTION_B', 'manual', 'action-test');

INSERT INTO public.actions
  (id, person_id, opportunity_id, interaction_id, action_type, title, source, created_by_uid,
   urgency_score, impact_score, confidence_score, effort_score, priority_score)
VALUES (-928021, -928001, -928031, -928011, 'call', 'ACTION_TEST_OPEN', 'manual', 'action-test',
        75.25, 80, 90, 20, 77.5);

DO $checks$ BEGIN
  IF (SELECT count(*) FROM public.actions WHERE id = -928021 AND status = 'open') <> 1 THEN
    RAISE EXCEPTION 'marked action was not created';
  END IF;
  BEGIN
    INSERT INTO public.actions (id, person_id, interaction_id, action_type, title, source, created_by_uid)
    VALUES (-928022, -928001, -928012, 'call', 'ACTION_TEST_WRONG_PERSON', 'manual', 'action-test');
    RAISE EXCEPTION 'wrong-Person interaction unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.actions (id, person_id, opportunity_id, action_type, title, source, created_by_uid)
    VALUES (-928025, -928001, -928032, 'call', 'ACTION_TEST_WRONG_OPPORTUNITY', 'manual', 'action-test');
    RAISE EXCEPTION 'wrong-Person opportunity unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.actions (id, person_id, action_type, title, source, created_by_uid)
    VALUES (-928023, -928001, 'call', 'ACTION_TEST_UNCONFIRMED_AI', 'ai_results', 'action-test');
    RAISE EXCEPTION 'unconfirmed AI action unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.actions
      (id, person_id, action_type, title, source, created_by_uid, priority_score)
    VALUES (-928024, -928001, 'call', 'ACTION_TEST_BAD_SCORE', 'manual', 'action-test', 101);
    RAISE EXCEPTION 'score above 100 unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.actions WHERE id BETWEEN -928025 AND -928021) <> 1 THEN
    RAISE EXCEPTION 'rejected actions were persisted';
  END IF;
END $checks$;

UPDATE public.actions SET status = 'completed', completed_at = now(),
  completed_by_uid = 'action-test' WHERE id = -928021;
DO $checks$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.actions
                 WHERE id = -928021 AND status = 'completed'
                   AND completed_at IS NOT NULL AND completed_by_uid = 'action-test') THEN
    RAISE EXCEPTION 'completion did not persist';
  END IF;
END $checks$;
ROLLBACK;
