-- PMC-20 verification A: actions_guard must ACCEPT an action whose opportunity is linked
-- to the person through customers.person_id (the new branch). Row is deleted in the same
-- DO block, so net data change is zero (only the id sequence advances).
DO $$
DECLARE v_opp bigint; v_person bigint; v_id bigint;
BEGIN
  SELECT o.id, c.person_id INTO v_opp, v_person
  FROM public.opportunities o
  JOIN public.customers c ON c."Id" = o.customer_id
  WHERE o.deleted_at IS NULL AND c.person_id IS NOT NULL
  LIMIT 1;
  IF v_opp IS NULL THEN
    RAISE EXCEPTION 'PMC20-NO-FIXTURE: no customer-linked opportunity exists';
  END IF;
  INSERT INTO public.actions (person_id, opportunity_id, action_type, title, source, created_by_uid)
  VALUES (v_person, v_opp, 'test', 'PMC20 guard verify (auto-removed)', 'manual', 'pmc20-verify')
  RETURNING id INTO v_id;
  DELETE FROM public.actions WHERE id = v_id AND created_by_uid = 'pmc20-verify';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PMC20-CLEANUP-FAIL: probe action % not removed', v_id;
  END IF;
  RAISE NOTICE 'PMC20-GUARD-ACCEPT-OK opp=% person=% action=%', v_opp, v_person, v_id;
END $$;
