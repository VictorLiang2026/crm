-- Rollback PMC-15: role derivation + relationship/household governance.
-- Reverse order. Safe only while relationships still carries no confirmed human data
-- (production had zero rows at migration time); guards abort otherwise.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- 6. Restore the pre-PMC-15 crm_search_people_v1 body (no status filter) ---------------
CREATE OR REPLACE FUNCTION public.crm_search_people_v1(
  p_template text, p_months integer DEFAULT 3, p_limit integer DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $function$
DECLARE
  local_today date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  result jsonb;
BEGIN
  IF p_template IS NULL OR
     p_template NOT IN ('activity_no_followup', 'child_education_no_insurance', 'declining_priority')
     OR p_months IS NULL OR p_months NOT BETWEEN 1 AND 12
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid CRM search criteria' USING ERRCODE = '22023';
  END IF;

  IF p_template = 'activity_no_followup' THEN
    WITH attendance AS (
      SELECT p.id AS person_id, p.display_name, p.legacy_customer_id,
        ap.id AS participant_id, a.id AS activity_id, a.activity_date,
        ap.followup_status,
        row_number() OVER (PARTITION BY p.id ORDER BY a.activity_date DESC, ap.id DESC) AS rn
      FROM public.persons p
      JOIN public.activity_participants ap ON
        ap.canonical_person_id = p.id OR
        (ap.canonical_person_id IS NULL AND
          ((ap.person_type = 'person' AND ap.person_id = p.id)
           OR (ap.person_type = 'customer' AND ap.person_id = p.legacy_customer_id)
           OR (ap.person_type = 'recruit' AND EXISTS (
             SELECT 1 FROM public.recruit_candidates rc
             WHERE rc.id = ap.person_id AND rc.person_id = p.id AND rc.deleted_at IS NULL))))
      JOIN public.activities a ON a.id = ap.activity_id
      WHERE p.deleted_at IS NULL AND ap.deleted_at IS NULL AND a.deleted_at IS NULL
        AND ap.status = 'attended'
        AND a.activity_date >= (local_today - make_interval(months => p_months))::date
        AND a.activity_date <= local_today
        AND (p.legacy_customer_id IS NULL OR EXISTS (
          SELECT 1 FROM public.customers c
          WHERE c."Id" = p.legacy_customer_id AND c.deleted_at IS NULL))
    ), matched AS (
      SELECT x.* FROM attendance x WHERE x.rn = 1
        AND x.followup_status IS DISTINCT FROM 'done'
        AND NOT EXISTS (SELECT 1 FROM public.followups f
          WHERE f.customer_id = x.legacy_customer_id AND f.deleted_at IS NULL
            AND f.followup_date >= x.activity_date)
        AND NOT EXISTS (SELECT 1 FROM public.recruit_followups rf
          JOIN public.recruit_candidates rc ON rc.id = rf.candidate_id
          WHERE rc.person_id = x.person_id AND rc.deleted_at IS NULL
            AND rf.deleted_at IS NULL AND rf.followup_date >= x.activity_date)
        AND NOT EXISTS (SELECT 1 FROM public.interactions i
          WHERE i.person_id = x.person_id AND i.interaction_type <> 'attendance'
            AND (i.interaction_at AT TIME ZONE 'Asia/Shanghai')::date >= x.activity_date)
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM matched),
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(z)) FROM (
        SELECT person_id, display_name, legacy_customer_id, activity_id,
          participant_id, activity_date FROM matched
        ORDER BY activity_date DESC, person_id LIMIT p_limit
      ) z), '[]'::jsonb),
      'coverage', jsonb_build_object('source', 'attended_participants',
        'rows', (SELECT count(*) FROM public.activity_participants ap
          JOIN public.activities a ON a.id = ap.activity_id
          WHERE ap.deleted_at IS NULL AND a.deleted_at IS NULL AND ap.status = 'attended'
            AND a.activity_date >= (local_today - make_interval(months => p_months))::date
            AND a.activity_date <= local_today))) INTO result;

  ELSIF p_template = 'child_education_no_insurance' THEN
    WITH matched AS (
      SELECT p.id AS person_id, p.display_name, p.legacy_customer_id,
        child.member_id AS child_member_id, edu.source_table AS education_source_table,
        edu.source_id AS education_source_id, edu.observed_at AS education_date
      FROM public.persons p
      JOIN LATERAL (
        SELECT hm.id AS member_id FROM public.households h
        JOIN public.household_members hm ON hm.household_id = h.id
        WHERE h.deleted_at IS NULL AND hm.deleted_at IS NULL AND hm.confirmed_at IS NOT NULL
          AND ((h.anchor_person_id = p.id AND hm.relationship_to_anchor = 'child')
            OR (hm.person_id = p.id AND hm.relationship_to_anchor = 'parent'))
        ORDER BY hm.created_at DESC, hm.id DESC LIMIT 1
      ) child ON true
      JOIN LATERAL (
        SELECT source_table, source_id, observed_at FROM (
          SELECT 'followups'::text AS source_table, f."Id"::bigint AS source_id,
            f.followup_date AS observed_at
          FROM public.followups f WHERE f.customer_id = p.legacy_customer_id
            AND f.deleted_at IS NULL
            AND f.followup_date >= (local_today - make_interval(months => p_months))::date
            AND concat_ws(' ', f.interaction_summary, f.followup_notes) ~ '(教育|学费|升学|学校)'
          UNION ALL
          SELECT 'interactions', i.id, (i.interaction_at AT TIME ZONE 'Asia/Shanghai')::date
          FROM public.interactions i WHERE i.person_id = p.id
            AND (i.interaction_at AT TIME ZONE 'Asia/Shanghai')::date >=
              (local_today - make_interval(months => p_months))::date
            AND concat_ws(' ', i.summary, i.raw_note) ~ '(教育|学费|升学|学校)'
          UNION ALL
          SELECT 'context_items', ci.id, (ci.created_at AT TIME ZONE 'Asia/Shanghai')::date
          FROM public.context_items ci WHERE ci.person_id = p.id AND ci.confirmed
            AND ci.category IN ('education', 'child_education')
            AND (ci.valid_to IS NULL OR ci.valid_to >= now())
            AND (ci.created_at AT TIME ZONE 'Asia/Shanghai')::date >=
              (local_today - make_interval(months => p_months))::date
        ) sources ORDER BY observed_at DESC, source_id DESC LIMIT 1
      ) edu ON true
      WHERE p.deleted_at IS NULL
        AND (p.legacy_customer_id IS NULL OR EXISTS (
          SELECT 1 FROM public.customers c
          WHERE c."Id" = p.legacy_customer_id AND c.deleted_at IS NULL))
        AND NOT EXISTS (SELECT 1 FROM public.followups f
          WHERE f.customer_id = p.legacy_customer_id AND f.deleted_at IS NULL
            AND concat_ws(' ', f.interaction_summary, f.followup_notes)
              ~ '(保险|保单|保障|寿险|重疾)')
        AND NOT EXISTS (SELECT 1 FROM public.interactions i
          WHERE i.person_id = p.id AND concat_ws(' ', i.summary, i.raw_note)
            ~ '(保险|保单|保障|寿险|重疾)')
        AND NOT EXISTS (SELECT 1 FROM public.context_items ci
          WHERE ci.person_id = p.id AND ci.confirmed
            AND ci.category IN ('insurance', 'coverage', 'policy')
            AND (ci.valid_to IS NULL OR ci.valid_to >= now()))
        AND NOT EXISTS (SELECT 1 FROM public.policy_review_reports prr
          WHERE prr.customer_id = p.legacy_customer_id AND prr.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM public.products product
          WHERE product.customer_id = p.legacy_customer_id AND product.deleted_at IS NULL)
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM matched),
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(z)) FROM (
        SELECT * FROM matched ORDER BY education_date DESC, person_id LIMIT p_limit
      ) z), '[]'::jsonb),
      'coverage', jsonb_build_object('source', 'confirmed_child_members',
        'rows', (SELECT count(*) FROM public.household_members hm
          JOIN public.households h ON h.id = hm.household_id
          WHERE h.deleted_at IS NULL AND hm.deleted_at IS NULL
            AND hm.confirmed_at IS NOT NULL AND hm.relationship_to_anchor IN ('child', 'parent')))) INTO result;

  ELSE
    WITH matched AS (
      SELECT p.id AS person_id, p.display_name, p.legacy_customer_id,
        c.sales_priority::text AS sales_priority,
        r.id AS relationship_id, r.from_person_id, r.to_person_id,
        r.trend, r.updated_at AS relationship_updated_at
      FROM public.persons p
      JOIN public.customers c ON c."Id" = p.legacy_customer_id AND c.deleted_at IS NULL
      JOIN LATERAL (
        SELECT rel.id, rel.from_person_id, rel.to_person_id, rel.trend, rel.updated_at
        FROM public.relationships rel
        WHERE rel.deleted_at IS NULL AND (rel.from_person_id = p.id OR rel.to_person_id = p.id)
          AND lower(btrim(rel.trend)) IN ('declining', 'down', '下降', '走弱')
          AND (rel.updated_at AT TIME ZONE 'Asia/Shanghai')::date >=
            (local_today - make_interval(months => p_months))::date
        ORDER BY rel.updated_at DESC, rel.id DESC LIMIT 1
      ) r ON true
      WHERE p.deleted_at IS NULL AND c.sales_priority::text IN ('A', 'B')
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM matched),
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(z)) FROM (
        SELECT * FROM matched ORDER BY relationship_updated_at DESC, person_id LIMIT p_limit
      ) z), '[]'::jsonb),
      'coverage', jsonb_build_object('source', 'recent_declining_relationships',
        'rows', (SELECT count(*) FROM public.relationships r
          WHERE r.deleted_at IS NULL
            AND lower(btrim(r.trend)) IN ('declining', 'down', '下降', '走弱')
            AND (r.updated_at AT TIME ZONE 'Asia/Shanghai')::date >=
              (local_today - make_interval(months => p_months))::date))) INTO result;
  END IF;

  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_search_people_v1(text,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_search_people_v1(text,integer,integer)
  TO service_role;
COMMENT ON FUNCTION public.crm_search_people_v1(text,integer,integer) IS
  'Read-only, fixed-template Person search. Results and evidence are computed only from public CRM records.';

-- 5. Reverse the one-time reconciliation (only while PMC-15 rows are still exactly it) --
DO $reverse_reconcile$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.person_roles
    WHERE role IN ('customer', 'recruit', 'speaker', 'participant')
      AND origin = 'derived'
      AND NOT (person_id = 777 AND role IN ('customer', 'recruit'))
  ) THEN
    RAISE EXCEPTION 'Other derived roles exist; manual review required before rollback';
  END IF;

  DELETE FROM public.person_roles
  WHERE person_id = 777 AND role IN ('customer', 'recruit') AND origin = 'derived';

  -- Re-create the two pre-migration stale snapshot rows with their original ids.
  INSERT INTO public.person_roles (id, person_id, role, origin, created_at, updated_at)
  SELECT 703, 768, 'customer', 'legacy_backfill', now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM public.person_roles WHERE id = 703);
  INSERT INTO public.person_roles (id, person_id, role, origin, created_at, updated_at)
  SELECT 792, 773, 'participant', 'legacy_backfill', now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM public.person_roles WHERE id = 792);

  PERFORM setval(pg_get_serial_sequence('public.person_roles', 'id'),
                 (SELECT coalesce(max(id), 1) FROM public.person_roles), true);
END $reverse_reconcile$;

-- 4. Drop derivation triggers and functions ---------------------------------------------
DROP TRIGGER IF EXISTS crm_person_role_persons_sync ON public.persons;
DROP TRIGGER IF EXISTS crm_person_role_participants_sync ON public.activity_participants;
DROP TRIGGER IF EXISTS crm_person_role_speakers_sync ON public.activity_speakers;
DROP TRIGGER IF EXISTS crm_person_role_recruits_sync ON public.recruit_candidates;
DROP TRIGGER IF EXISTS crm_person_role_customers_sync ON public.customers;
DROP FUNCTION IF EXISTS public.crm_person_role_sync_v1();
DROP FUNCTION IF EXISTS public.crm_person_roles_derive_v1(bigint);

-- 2/3. Relationships columns and checks -------------------------------------------------
DO $rel_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.relationships
    WHERE source <> 'manual' OR status <> 'pending'
       OR confirmed_at IS NOT NULL OR confirmed_by_uid IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'relationships already holds confirmed/non-manual data; rollback would lose governance history';
  END IF;
END $rel_guard$;
ALTER TABLE public.relationships DROP CONSTRAINT IF EXISTS relationships_confirmation_check;
ALTER TABLE public.relationships DROP CONSTRAINT IF EXISTS relationships_type_vocab_check;
ALTER TABLE public.relationships
  DROP COLUMN IF EXISTS confirmed_by_uid,
  DROP COLUMN IF EXISTS confirmed_at,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS source;

-- 1. Restore the original origin vocabulary ---------------------------------------------
ALTER TABLE public.person_roles DROP CONSTRAINT person_roles_origin_check;
ALTER TABLE public.person_roles
  ADD CONSTRAINT person_roles_origin_check
  CHECK (origin IN ('manual', 'legacy_backfill'));

COMMENT ON TABLE public.person_roles IS
  'Per-person catalog roles; the snapshot rows (legacy_backfill) were seeded from active business records on 2026-09-25 and manual rows are created by identity resolution';
COMMENT ON TABLE public.relationships IS
  'Directed, soft-deletable relationship edge between two persons; reverse direction is a separate row';
COMMENT ON TABLE public.households IS
  'One optional lightweight family context per anchor person; relationship_to_anchor stays generic';
COMMIT;
