-- One statement: a PL/pgSQL exception subtransaction rolls back all marked fixtures.
DO $test$
BEGIN
  BEGIN
  IF EXISTS (SELECT 1 FROM public.persons WHERE id IN (-927001, -927002))
     OR EXISTS (SELECT 1 FROM public.interactions WHERE id = -927001)
     OR EXISTS (SELECT 1 FROM public.context_items WHERE id BETWEEN -927099 AND -927001) THEN
    RAISE EXCEPTION 'CRM_TEST_ONLY context fixture IDs already exist';
  END IF;

INSERT INTO public.persons (id, display_name, name_key, source) VALUES
  (-927001, '[CRM_TEST_ONLY] Context Person A', '[CRM_TEST_ONLY] Context Person A', 'CRM_TEST_ONLY'),
  (-927002, '[CRM_TEST_ONLY] Context Person B', '[CRM_TEST_ONLY] Context Person B', 'CRM_TEST_ONLY');
INSERT INTO public.interactions
  (id, person_id, interaction_type, interaction_at, summary, source_type, created_by_uid)
VALUES
  (-927001, -927001, 'test', now(), '[CRM_TEST_ONLY] Context interaction',
   'manual', '[CRM_TEST_ONLY]');

INSERT INTO public.context_items
  (id, person_id, interaction_id, item_type, content, source_type, source_id)
VALUES
  (-927001, -927001, -927001, 'signal', '[CRM_TEST_ONLY] signal', 'interactions', -927001);
INSERT INTO public.context_items
  (id, person_id, item_type, content, source_type, confidence)
VALUES
  (-927002, -927001, 'inference', '[CRM_TEST_ONLY] inference', 'manual', 0.400);
INSERT INTO public.context_items
  (id, person_id, item_type, content, source_type, source_id)
VALUES
  (-927003, -927001, 'fact', '[CRM_TEST_ONLY] AI fact candidate', 'ai_results', -927003);
INSERT INTO public.context_items
  (id, person_id, item_type, content, source_type, confirmed, confirmed_by_uid, confirmed_at)
VALUES
  (-927004, -927001, 'fact', '[CRM_TEST_ONLY] human fact', 'manual',
   true, '[CRM_TEST_ONLY]human', now());

  IF (SELECT count(*) FROM public.context_items WHERE id BETWEEN -927099 AND -927001) <> 4
     OR (SELECT confirmed FROM public.context_items WHERE id = -927003)
     OR NOT (SELECT confirmed FROM public.context_items WHERE id = -927004) THEN
    RAISE EXCEPTION 'context item type/confirmation defaults failed';
  END IF;

  BEGIN
    INSERT INTO public.context_items
      (id, person_id, item_type, content, source_type, source_id,
       confirmed, confirmed_by_uid, confirmed_at)
    VALUES
      (-927005, -927001, 'fact', '[CRM_TEST_ONLY] invalid AI confirmed fact',
       'ai_results', -927005, true, '[CRM_TEST_ONLY]human', now());
    RAISE EXCEPTION 'AI Fact Candidate direct confirmation unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.context_items
      (id, person_id, interaction_id, item_type, content, source_type, source_id)
    VALUES
      (-927006, -927002, -927001, 'signal', '[CRM_TEST_ONLY] wrong Person interaction',
       'interactions', -927001);
    RAISE EXCEPTION 'cross-Person interaction unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.context_items SET item_type = 'fact' WHERE id = -927002;
    RAISE EXCEPTION 'Signal-to-Fact mutation unexpectedly succeeded';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL;
  END;

  IF (SELECT count(*) FROM public.context_items WHERE id BETWEEN -927099 AND -927001) <> 4 THEN
    RAISE EXCEPTION 'rejected context rows leaked into transaction';
  END IF;
  RAISE EXCEPTION 'CRM_TEST_ONLY_ROLLBACK' USING ERRCODE = 'P7001';
  EXCEPTION WHEN SQLSTATE 'P7001' THEN NULL;
  END;
END;
$test$;
