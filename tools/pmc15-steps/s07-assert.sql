DO $reconcile_assert$
DECLARE
  v_stale bigint[];
  v_missing_count integer;
  v_total integer;
BEGIN
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_stale
  FROM public.person_roles
  WHERE (role = 'customer' AND NOT EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.deleted_at IS NULL AND (
        c.person_id = person_roles.person_id
        OR EXISTS (SELECT 1 FROM public.persons pp
                   WHERE pp.id = person_roles.person_id AND pp.legacy_customer_id = c."Id"))))
     OR (role = 'recruit' AND NOT EXISTS (
        SELECT 1 FROM public.recruit_candidates rc
        WHERE rc.deleted_at IS NULL AND rc.person_id = person_roles.person_id))
     OR (role = 'speaker' AND NOT EXISTS (
        SELECT 1 FROM public.activity_speakers s
        WHERE s.deleted_at IS NULL AND s.person_id = person_roles.person_id))
     OR (role = 'participant' AND NOT EXISTS (
        SELECT 1 FROM public.activity_participants ap
        WHERE ap.deleted_at IS NULL AND ap.canonical_person_id = person_roles.person_id));
  IF v_stale <> ARRAY[703::bigint, 792::bigint] THEN
    RAISE EXCEPTION 'PMC-15 stale role ids changed since inventory: %', v_stale;
  END IF;

  SELECT count(*) INTO v_missing_count
  FROM (VALUES ('customer'::text), ('recruit'::text)) AS r(role)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.person_roles prole
    WHERE prole.person_id = 777 AND prole.role = r.role);
  IF v_missing_count <> 2 THEN
    RAISE EXCEPTION 'PMC-15 expected exactly 2 missing roles for person 777, got %', v_missing_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.persons WHERE id = 777 AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'PMC-15 person 777 must be active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers
                 WHERE "Id" = 785 AND person_id = 777 AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'PMC-15 customer 785 / person 777 evidence changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recruit_candidates
                 WHERE id = 17 AND person_id = 777 AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'PMC-15 candidate 17 / person 777 evidence changed';
  END IF;

  SELECT count(*) INTO v_total FROM public.person_roles;
  IF v_total <> 799 THEN
    RAISE EXCEPTION 'PMC-15 person_roles total changed since inventory: %', v_total;
  END IF;
END $reconcile_assert$;
