-- PMC-20 verification B: actions_guard must REJECT an action linking an opportunity to a
-- non-owner person (expects SQLSTATE 23514). No row is persisted.
DO $$
DECLARE v_opp bigint; v_person bigint; v_other bigint;
BEGIN
  SELECT o.id, c.person_id INTO v_opp, v_person
  FROM public.opportunities o
  JOIN public.customers c ON c."Id" = o.customer_id
  WHERE o.deleted_at IS NULL AND c.person_id IS NOT NULL
  LIMIT 1;
  SELECT p.id INTO v_other FROM public.persons p
  WHERE p.id <> v_person AND p.deleted_at IS NULL LIMIT 1;
  BEGIN
    INSERT INTO public.actions (person_id, opportunity_id, action_type, title, source, created_by_uid)
    VALUES (v_other, v_opp, 'test', 'PMC20 guard reject probe (should not persist)', 'manual', 'pmc20-verify');
  EXCEPTION WHEN others THEN
    IF SQLSTATE = '23514' THEN
      RAISE NOTICE 'PMC20-GUARD-REJECT-OK opp=% owner=% other=%', v_opp, v_person, v_other;
      RETURN;
    END IF;
    RAISE EXCEPTION 'PMC20-GUARD-WRONG-ERROR sqlstate=% msg=%', SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'PMC20-GUARD-MISSING: non-owner link was accepted';
END $$;
