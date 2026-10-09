-- PMC-15 q2: person_roles distribution and drift vs live business tables
WITH dist AS (
  SELECT role, origin, count(*) AS n
  FROM public.person_roles GROUP BY role, origin
), orphans AS (
  SELECT count(*) AS n FROM public.person_roles pr
  LEFT JOIN public.persons p ON p.id=pr.person_id
  WHERE p.id IS NULL
), deleted_person AS (
  SELECT count(*) AS n FROM public.person_roles pr
  JOIN public.persons p ON p.id=pr.person_id
  WHERE p.deleted_at IS NOT NULL
), cust AS (
  -- active customers with person_id
  SELECT count(*) FILTER (WHERE deleted_at IS NULL AND person_id IS NOT NULL) AS active_with_person,
         count(*) FILTER (WHERE deleted_at IS NULL AND person_id IS NULL) AS active_without_person,
         count(*) FILTER (WHERE deleted_at IS NOT NULL AND person_id IS NOT NULL) AS deleted_with_person
  FROM public.customers
), cust_role AS (
  SELECT count(*) AS active_customer_roles
  FROM public.person_roles pr WHERE pr.role='customer'
), cust_missing AS (
  -- active mapped customers lacking a customer role row
  SELECT count(*) AS n FROM public.customers c
  WHERE c.deleted_at IS NULL AND c.person_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id=c.person_id AND pr.role='customer')
), cust_stale AS (
  -- customer role rows for persons whose only customer record is soft-deleted
  SELECT count(*) AS n FROM public.person_roles pr
  WHERE pr.role='customer'
    AND EXISTS (SELECT 1 FROM public.customers c WHERE c.person_id=pr.person_id)
    AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.person_id=pr.person_id AND c.deleted_at IS NULL)
), cust_no_rec AS (
  -- customer role rows for persons with NO customers row at all
  SELECT count(*) AS n FROM public.person_roles pr
  WHERE pr.role='customer'
    AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.person_id=pr.person_id)
), rec_missing AS (
  SELECT count(*) AS n FROM public.recruit_candidates rc
  WHERE rc.deleted_at IS NULL AND rc.person_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id=rc.person_id AND pr.role='recruit')
), rec_stale AS (
  SELECT count(*) AS n FROM public.person_roles pr
  WHERE pr.role='recruit'
    AND NOT EXISTS (SELECT 1 FROM public.recruit_candidates rc WHERE rc.person_id=pr.person_id AND rc.deleted_at IS NULL)
), spk_missing AS (
  SELECT count(*) AS n FROM public.activity_speakers s
  WHERE s.deleted_at IS NULL AND s.person_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id=s.person_id AND pr.role='speaker')
), spk_stale AS (
  SELECT count(*) AS n FROM public.person_roles pr
  WHERE pr.role='speaker'
    AND NOT EXISTS (SELECT 1 FROM public.activity_speakers s WHERE s.person_id=pr.person_id AND s.deleted_at IS NULL)
), part_missing AS (
  SELECT count(*) AS n FROM (
    SELECT DISTINCT ap.canonical_person_id AS pid
    FROM public.activity_participants ap
    WHERE ap.deleted_at IS NULL AND ap.canonical_person_id IS NOT NULL
  ) x
  WHERE NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id=x.pid AND pr.role='participant')
), part_stale AS (
  SELECT count(*) AS n FROM public.person_roles pr
  WHERE pr.role='participant'
    AND NOT EXISTS (SELECT 1 FROM public.activity_participants ap
                    WHERE ap.canonical_person_id=pr.person_id AND ap.deleted_at IS NULL)
)
SELECT jsonb_build_object(
  'distribution', (SELECT jsonb_agg(jsonb_build_object('role',role,'origin',origin,'n',n) ORDER BY role,origin) FROM dist),
  'orphan_roles', (SELECT n FROM orphans),
  'roles_on_deleted_persons', (SELECT n FROM deleted_person),
  'customers', (SELECT to_jsonb(cust) FROM cust),
  'customer_role_rows', (SELECT active_customer_roles FROM cust_role),
  'customer_role_missing_for_active', (SELECT n FROM cust_missing),
  'customer_role_stale_softdeleted_only', (SELECT n FROM cust_stale),
  'customer_role_no_customer_record', (SELECT n FROM cust_no_rec),
  'recruit_role_missing', (SELECT n FROM rec_missing),
  'recruit_role_stale', (SELECT n FROM rec_stale),
  'speaker_role_missing', (SELECT n FROM spk_missing),
  'speaker_role_stale', (SELECT n FROM spk_stale),
  'participant_role_missing', (SELECT n FROM part_missing),
  'participant_role_stale', (SELECT n FROM part_stale)
) AS snapshot;
