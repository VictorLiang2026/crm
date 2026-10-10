-- PMC-20 compatibility fix: crm_person_roles_derive_v1 still referenced dropped
-- persons.legacy_customer_id (CL-03) in a legacy-link OR branch, so role derivation
-- failed whenever the trigger tree called it. All customers now carry person_id
-- (NOT NULL, backfilled PMC-17), so the legacy OR branch is obsolete.
CREATE OR REPLACE FUNCTION public.crm_person_roles_derive_v1(p_person_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF p_person_id IS NULL THEN
    RETURN;
  END IF;

  -- A soft-deleted Person holds no derived business roles.
  IF EXISTS (SELECT 1 FROM public.persons WHERE id = p_person_id AND deleted_at IS NOT NULL) THEN
    DELETE FROM public.person_roles WHERE person_id = p_person_id
      AND role IN ('customer', 'recruit', 'speaker', 'participant');
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.deleted_at IS NULL AND c.person_id = p_person_id
  ) THEN
    INSERT INTO public.person_roles (person_id, role, origin)
    VALUES (p_person_id, 'customer', 'derived')
    ON CONFLICT (person_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.person_roles
    WHERE person_id = p_person_id AND role = 'customer';
  END IF;

  IF EXISTS (SELECT 1 FROM public.recruit_candidates rc
             WHERE rc.deleted_at IS NULL AND rc.person_id = p_person_id) THEN
    INSERT INTO public.person_roles (person_id, role, origin)
    VALUES (p_person_id, 'recruit', 'derived')
    ON CONFLICT (person_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.person_roles
    WHERE person_id = p_person_id AND role = 'recruit';
  END IF;

  IF EXISTS (SELECT 1 FROM public.activity_speakers s
             WHERE s.deleted_at IS NULL AND s.person_id = p_person_id) THEN
    INSERT INTO public.person_roles (person_id, role, origin)
    VALUES (p_person_id, 'speaker', 'derived')
    ON CONFLICT (person_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.person_roles
    WHERE person_id = p_person_id AND role = 'speaker';
  END IF;

  IF EXISTS (SELECT 1 FROM public.activity_participants ap
             WHERE ap.deleted_at IS NULL AND ap.canonical_person_id = p_person_id) THEN
    INSERT INTO public.person_roles (person_id, role, origin)
    VALUES (p_person_id, 'participant', 'derived')
    ON CONFLICT (person_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.person_roles
    WHERE person_id = p_person_id AND role = 'participant';
  END IF;
END $function$;
