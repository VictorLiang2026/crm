-- PMC-15 q6: precise drift rows (ids + business state), no PII names
SELECT jsonb_build_object(
  'customer_missing', (
    SELECT jsonb_agg(jsonb_build_object('customer_id',c."Id",'person_id',c.person_id))
    FROM public.customers c
    WHERE c.deleted_at IS NULL AND c.person_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id=c.person_id AND pr.role='customer')
  ),
  'customer_role_no_record', (
    SELECT jsonb_agg(jsonb_build_object('role_id',pr.id,'person_id',pr.person_id,'origin',pr.origin,
                       'person_deleted',p.deleted_at IS NOT NULL,
                       'legacy_customer_id',p.legacy_customer_id))
    FROM public.person_roles pr JOIN public.persons p ON p.id=pr.person_id
    WHERE pr.role='customer'
      AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.person_id=pr.person_id)
  ),
  'recruit_missing', (
    SELECT jsonb_agg(jsonb_build_object('candidate_id',rc.id,'person_id',rc.person_id,'customer_id',rc.customer_id))
    FROM public.recruit_candidates rc
    WHERE rc.deleted_at IS NULL AND rc.person_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.person_roles pr WHERE pr.person_id=rc.person_id AND pr.role='recruit')
  ),
  'participant_stale', (
    SELECT jsonb_agg(jsonb_build_object('role_id',pr.id,'person_id',pr.person_id,'origin',pr.origin,
                       'person_deleted',p.deleted_at IS NOT NULL))
    FROM public.person_roles pr JOIN public.persons p ON p.id=pr.person_id
    WHERE pr.role='participant'
      AND NOT EXISTS (SELECT 1 FROM public.activity_participants ap
                      WHERE ap.canonical_person_id=pr.person_id AND ap.deleted_at IS NULL)
  ),
  'roles_on_deleted_persons', (
    SELECT jsonb_agg(jsonb_build_object('role_id',pr.id,'person_id',pr.person_id,'role',pr.role,'origin',pr.origin))
    FROM public.person_roles pr JOIN public.persons p ON p.id=pr.person_id
    WHERE p.deleted_at IS NOT NULL
  ),
  'manual_business_roles', (
    SELECT jsonb_agg(jsonb_build_object('role_id',id,'person_id',person_id,'role',role) ORDER BY role, id)
    FROM public.person_roles WHERE origin='manual'
  ),
  'active_customers_without_person', (
    SELECT jsonb_agg(jsonb_build_object('customer_id',"Id"))
    FROM public.customers WHERE deleted_at IS NULL AND person_id IS NULL
  )
) AS snapshot;
