-- PMC-15 live functional regression. Every assertion runs inside one DO block;
-- the final RAISE rolls the ENTIRE block back, leaving zero test residue.
-- Success signal: error message PMC15_TEST_ROLLBACK_OK. Must run as service_role
-- (canonical_person_id guard + RLS).
DO $pmc15test$
DECLARE
  v_p bigint; v_p2 bigint; v_cid bigint; v_rc bigint; v_sp bigint;
  v_act bigint; v_ap bigint; v_rid bigint; v_rev bigint; v_count int;
BEGIN
  INSERT INTO public.persons(display_name, name_key)
    VALUES ('[CRM_TEST_ONLY] PMC15 派生回归甲', 'zzcrmtestpmc15a') RETURNING id INTO v_p;
  INSERT INTO public.persons(display_name, name_key)
    VALUES ('[CRM_TEST_ONLY] PMC15 关系端点乙', 'zzcrmtestpmc15b') RETURNING id INTO v_p2;

  PERFORM public.crm_person_roles_derive_v1(v_p);
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id = v_p;
  ASSERT v_count = 0, 'person with no business evidence must have no roles';

  -- recruit: insert -> derived; soft-delete -> removed; restore -> back
  INSERT INTO public.recruit_candidates(person_id) VALUES (v_p) RETURNING id INTO v_rc;
  SELECT count(*) INTO v_count FROM public.person_roles
    WHERE person_id=v_p AND role='recruit' AND origin='derived';
  ASSERT v_count = 1, 'candidate insert must derive recruit';
  UPDATE public.recruit_candidates SET deleted_at=now() WHERE id=v_rc;
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='recruit';
  ASSERT v_count = 0, 'candidate soft-delete must remove recruit';
  UPDATE public.recruit_candidates SET deleted_at=NULL WHERE id=v_rc;
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='recruit';
  ASSERT v_count = 1, 'candidate restore must re-derive recruit';

  -- speaker (multi-role person)
  INSERT INTO public.activity_speakers(name, person_id)
    VALUES ('[CRM_TEST_ONLY] PMC15 嘉宾', v_p) RETURNING id INTO v_sp;
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='speaker';
  ASSERT v_count = 1, 'speaker insert must derive speaker';

  -- participant via canonical
  INSERT INTO public.activities(name) VALUES ('[CRM_TEST_ONLY] PMC15 活动') RETURNING id INTO v_act;
  INSERT INTO public.activity_participants(activity_id, person_type, status, canonical_person_id)
    VALUES (v_act, 'person', 'attended', v_p) RETURNING id INTO v_ap;
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='participant';
  ASSERT v_count = 1, 'canonical participant must derive participant';
  UPDATE public.activity_participants SET deleted_at=now() WHERE id=v_ap;
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='participant';
  ASSERT v_count = 0, 'participant soft-delete must remove participant';
  UPDATE public.activity_participants SET deleted_at=NULL WHERE id=v_ap;
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='participant';
  ASSERT v_count = 1, 'participant restore must re-derive participant';

  -- customer: direct link, then unlink -> bridge link, soft-delete/restore
  INSERT INTO public.customers(customer_name, person_id)
    VALUES ('[CRM_TEST_ONLY] PMC15 客户', v_p) RETURNING "Id" INTO v_cid;
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='customer';
  ASSERT v_count = 1, 'customer direct link must derive customer';
  UPDATE public.customers SET person_id=NULL WHERE "Id"=v_cid;
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='customer';
  ASSERT v_count = 0, 'unlinked customer must remove customer role';
  UPDATE public.persons SET legacy_customer_id=v_cid WHERE id=v_p;
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='customer';
  ASSERT v_count = 1, 'legacy bridge link must derive customer';
  UPDATE public.customers SET deleted_at=now() WHERE "Id"=v_cid;
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='customer';
  ASSERT v_count = 0, 'customer soft-delete must remove customer role even via bridge';
  UPDATE public.customers SET deleted_at=NULL WHERE "Id"=v_cid;
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='customer';
  ASSERT v_count = 1, 'customer restore via bridge must re-derive customer';

  -- human-only tag survives every derived transition
  INSERT INTO public.person_roles(person_id, role, origin) VALUES (v_p, 'partner', 'manual');
  UPDATE public.persons SET deleted_at=now() WHERE id=v_p;
  SELECT count(*) INTO v_count FROM public.person_roles
    WHERE person_id=v_p AND role IN ('customer','recruit','speaker','participant');
  ASSERT v_count = 0, 'soft-deleted Person holds no derived roles';
  SELECT count(*) INTO v_count FROM public.person_roles WHERE person_id=v_p AND role='partner';
  ASSERT v_count = 1, 'human-only partner tag must survive person soft-delete';
  UPDATE public.persons SET deleted_at=NULL WHERE id=v_p;
  SELECT count(*) INTO v_count FROM public.person_roles
    WHERE person_id=v_p AND role IN ('customer','recruit','speaker','participant');
  ASSERT v_count = 4, 'person restore must bring all four derived roles back';

  -- relationships governance
  INSERT INTO public.relationships(from_person_id, to_person_id, relationship_type)
    VALUES (v_p, v_p2, 'friend') RETURNING id INTO v_rid;
  -- defaults: pending + manual
  ASSERT (SELECT status='pending' AND source='manual' AND confirmed_at IS NULL
          FROM public.relationships WHERE id=v_rid), 'new edge defaults to pending/manual';

  BEGIN
    UPDATE public.relationships SET status='confirmed' WHERE id=v_rid;
    ASSERT false, 'confirm without metadata must fail';
  EXCEPTION WHEN check_violation THEN END;

  BEGIN
    INSERT INTO public.relationships(from_person_id,to_person_id,relationship_type)
      VALUES (v_p,v_p2,'spouse');
    ASSERT false, 'vocabulary must reject spouse';
  EXCEPTION WHEN check_violation THEN END;

  BEGIN
    INSERT INTO public.relationships(from_person_id,to_person_id,relationship_type)
      VALUES (v_p,v_p,'friend');
    ASSERT false, 'self relationship must fail';
  EXCEPTION WHEN check_violation THEN END;

  BEGIN
    INSERT INTO public.relationships(from_person_id,to_person_id,relationship_type)
      VALUES (v_p,v_p2,'friend');
    ASSERT false, 'duplicate active directed edge must fail';
  EXCEPTION WHEN unique_violation THEN END;

  UPDATE public.relationships
    SET status='confirmed', confirmed_at=now(), confirmed_by_uid='crm-test-pmc15'
    WHERE id=v_rid;
  BEGIN
    UPDATE public.relationships SET confirmed_by_uid=NULL WHERE id=v_rid;
    ASSERT false, 'confirmed edge losing uid must fail';
  EXCEPTION WHEN check_violation THEN END;

  -- reverse direction is an independent edge
  INSERT INTO public.relationships(from_person_id,to_person_id,relationship_type,status,confirmed_at,confirmed_by_uid)
    VALUES (v_p2,v_p,'friend','confirmed',now(),'crm-test-pmc15') RETURNING id INTO v_rev;
  BEGIN
    INSERT INTO public.relationships(from_person_id,to_person_id,relationship_type)
      VALUES (v_p2,v_p,'friend');
    ASSERT false, 'duplicate reverse edge must fail';
  EXCEPTION WHEN unique_violation THEN END;

  -- soft-delete recovery: deleted edge frees the active unique slot
  UPDATE public.relationships SET deleted_at=now() WHERE id=v_rid;
  INSERT INTO public.relationships(from_person_id,to_person_id,relationship_type)
    VALUES (v_p,v_p2,'friend');
  UPDATE public.relationships SET deleted_at=now() WHERE id=v_rev;

  RAISE EXCEPTION 'PMC15_TEST_ROLLBACK_OK';
END $pmc15test$;
