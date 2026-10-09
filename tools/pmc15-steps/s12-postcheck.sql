SELECT to_jsonb(x) AS postcheck FROM (
  SELECT
    (SELECT jsonb_object_agg(role, n ORDER BY role) FROM (
       SELECT role, count(*) AS n FROM public.person_roles GROUP BY role) r) AS role_dist,
    (SELECT jsonb_object_agg(origin, n ORDER BY origin) FROM (
       SELECT origin, count(*) AS n FROM public.person_roles GROUP BY origin) o) AS origin_dist,
    (SELECT count(*) FROM public.person_roles) AS total,
    -- derived drift: business roles without active evidence (must be 0)
    (SELECT count(*) FROM public.person_roles pr WHERE
      (role='customer' AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.deleted_at IS NULL
         AND (c.person_id=pr.person_id OR EXISTS (SELECT 1 FROM public.persons pp
              WHERE pp.id=pr.person_id AND pp.legacy_customer_id=c."Id"))))
      OR (role='recruit' AND NOT EXISTS (SELECT 1 FROM public.recruit_candidates rc
            WHERE rc.deleted_at IS NULL AND rc.person_id=pr.person_id))
      OR (role='speaker' AND NOT EXISTS (SELECT 1 FROM public.activity_speakers s
            WHERE s.deleted_at IS NULL AND s.person_id=pr.person_id))
      OR (role='participant' AND NOT EXISTS (SELECT 1 FROM public.activity_participants ap
            WHERE ap.deleted_at IS NULL AND ap.canonical_person_id=pr.person_id))) AS stale_roles,
    (SELECT count(*) FROM public.person_roles pr
      WHERE EXISTS (SELECT 1 FROM public.persons p WHERE p.id=pr.person_id AND p.deleted_at IS NOT NULL)
        AND pr.role IN ('customer','recruit','speaker','participant')) AS roles_on_deleted_persons,
    -- missing derived roles (must be 0): active evidence without role
    (SELECT count(*) FROM public.persons p WHERE p.deleted_at IS NULL AND (
        EXISTS (SELECT 1 FROM public.customers c WHERE c.deleted_at IS NULL
          AND (c.person_id=p.id OR p.legacy_customer_id=c."Id"))
        AND NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id=p.id AND pr.role='customer')
        OR EXISTS (SELECT 1 FROM public.recruit_candidates rc WHERE rc.deleted_at IS NULL AND rc.person_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id=p.id AND pr.role='recruit')
        OR EXISTS (SELECT 1 FROM public.activity_speakers s WHERE s.deleted_at IS NULL AND s.person_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id=p.id AND pr.role='speaker')
        OR EXISTS (SELECT 1 FROM public.activity_participants ap WHERE ap.deleted_at IS NULL AND ap.canonical_person_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id=p.id AND pr.role='participant'))) AS missing_roles,
    (SELECT count(*) FROM public.relationships) AS relationships_total,
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
      AND table_name='relationships' AND column_name IN ('source','status','confirmed_at','confirmed_by_uid')) AS governance_cols,
    (SELECT count(*) FROM pg_trigger WHERE tgrelid IN
      ('public.customers'::regclass,'public.recruit_candidates'::regclass,'public.activity_speakers'::regclass,
       'public.activity_participants'::regclass,'public.persons'::regclass)
      AND tgname LIKE 'crm_person_role_%_sync' AND NOT tgisinternal) AS sync_triggers,
    -- live regression residue check
    (SELECT count(*) FROM public.persons WHERE display_name LIKE '[CRM_TEST_ONLY] PMC15%') AS test_person_residue
) x;
