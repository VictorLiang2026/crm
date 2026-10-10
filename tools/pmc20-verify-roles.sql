-- PMC-20 verification C: crm_person_roles_derive_v1 must execute without error for an
-- active customer-linked person and (re)derive the 'customer' role. Idempotent.
DO $$
DECLARE v_person bigint; v_before text; v_after text;
BEGIN
  SELECT person_id INTO v_person FROM public.customers
  WHERE deleted_at IS NULL AND person_id IS NOT NULL LIMIT 1;
  SELECT string_agg(role, ',' ORDER BY role) INTO v_before
  FROM public.person_roles WHERE person_id = v_person;
  PERFORM public.crm_person_roles_derive_v1(v_person);
  SELECT string_agg(role, ',' ORDER BY role) INTO v_after
  FROM public.person_roles WHERE person_id = v_person;
  IF v_after IS NULL OR strpos(',' || v_after || ',', ',customer,') = 0 THEN
    RAISE EXCEPTION 'PMC20-ROLE-FAIL person=% before=% after=%', v_person, v_before, v_after;
  END IF;
  RAISE NOTICE 'PMC20-ROLE-OK person=% before=% after=%', v_person, v_before, v_after;
END $$;
