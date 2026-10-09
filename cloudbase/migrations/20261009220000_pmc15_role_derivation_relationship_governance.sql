-- PMC-15: role derivation + relationship/household governance.
-- 1) person_roles: customer/recruit/speaker/participant become derived from active
--    business records (per-person recompute via triggers); partner/referrer/alumni/other
--    stay human-only tags. One-time reconciliation of known drift.
-- 2) relationships: add source / status / confirmed_at / confirmed_by_uid with
--    controlled vocabularies. Zero rows at application time.
-- 3) crm_search_people_v1: declining-relationship template only counts confirmed edges.
-- public schema only. No DROP of any table/view; triggers/functions created by this
-- migration are dropped by the matching rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- 1. person_roles.origin gains 'derived' ------------------------------------------------
ALTER TABLE public.person_roles
  DROP CONSTRAINT person_roles_origin_check;
ALTER TABLE public.person_roles
  ADD CONSTRAINT person_roles_origin_check
  CHECK (origin IN ('manual', 'legacy_backfill', 'derived'));

-- 2. relationships governance columns ---------------------------------------------------
ALTER TABLE public.relationships
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'ai_suggested', 'legacy_note')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed')),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by_uid text
    CHECK (confirmed_by_uid IS NULL OR btrim(confirmed_by_uid) <> '');

-- Controlled relationship vocabulary. Household roles stay in household_members and
-- insurance roles (policyholder/insured) stay in the policy/products domain; they must
-- not be collapsed into relationship types.
DO $vocab$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.relationships'::regclass
                   AND conname='relationships_type_vocab_check') THEN
    ALTER TABLE public.relationships
      ADD CONSTRAINT relationships_type_vocab_check
      CHECK (relationship_type IN
        ('family', 'friend', 'colleague', 'business', 'referral', 'other'));
  END IF;
END $vocab$;

-- Pending candidates carry no confirmation; confirmed facts require both metadata fields.
DO $confirm$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.relationships'::regclass
                   AND conname='relationships_confirmation_check') THEN
    ALTER TABLE public.relationships
      ADD CONSTRAINT relationships_confirmation_check CHECK (
        (status = 'pending'  AND confirmed_at IS NULL AND confirmed_by_uid IS NULL)
        OR
        (status = 'confirmed' AND confirmed_at IS NOT NULL
         AND btrim(confirmed_by_uid) IS NOT NULL AND btrim(confirmed_by_uid) <> '')
      );
  END IF;
END $confirm$;

-- 3. Per-person role recompute ----------------------------------------------------------
-- Business roles are derived truth. Evidence:
--   customer    -> active customers row via customers.person_id OR legacy_customer_id bridge
--   recruit     -> active recruit_candidates row with person_id
--   speaker     -> active activity_speakers row with person_id
--   participant -> active activity_participants row with canonical_person_id
-- Human-only tags (partner/referrer/alumni/other) are never touched.
CREATE OR REPLACE FUNCTION public.crm_person_roles_derive_v1(p_person_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $derive$
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
    WHERE c.deleted_at IS NULL AND (
      c.person_id = p_person_id
      OR EXISTS (SELECT 1 FROM public.persons pp
                 WHERE pp.id = p_person_id AND pp.legacy_customer_id = c."Id")
    )
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
END $derive$;
REVOKE ALL ON FUNCTION public.crm_person_roles_derive_v1(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_person_roles_derive_v1(bigint) TO service_role;
COMMENT ON FUNCTION public.crm_person_roles_derive_v1(bigint) IS
  'Recompute the four derived business roles for one Person from active business records; human-only role tags are untouched';

CREATE OR REPLACE FUNCTION public.crm_person_role_sync_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $sync$
DECLARE
  v_ids bigint[] := '{}';
  v_id bigint;
BEGIN
  IF TG_TABLE_NAME = 'customers' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || NEW.person_id;
      v_ids := v_ids || (SELECT coalesce(array_agg(id), '{}') FROM public.persons
                         WHERE legacy_customer_id = NEW."Id");
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || OLD.person_id;
      v_ids := v_ids || (SELECT coalesce(array_agg(id), '{}') FROM public.persons
                         WHERE legacy_customer_id = OLD."Id");
    END IF;
  ELSIF TG_TABLE_NAME = 'persons' THEN
    -- Only wired to AFTER UPDATE OF legacy_customer_id.
    v_ids := v_ids || NEW.id;
  ELSIF TG_TABLE_NAME = 'activity_participants' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || NEW.canonical_person_id;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || OLD.canonical_person_id;
    END IF;
  ELSE
    -- recruit_candidates / activity_speakers carry person_id directly.
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || NEW.person_id;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || OLD.person_id;
    END IF;
  END IF;

  FOREACH v_id IN ARRAY (
    SELECT array_agg(DISTINCT x) FROM unnest(v_ids) AS x WHERE x IS NOT NULL
  ) LOOP
    PERFORM public.crm_person_roles_derive_v1(v_id);
  END LOOP;
  RETURN NULL;
END $sync$;
REVOKE ALL ON FUNCTION public.crm_person_role_sync_v1() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.crm_person_role_sync_v1() IS
  'AFTER trigger: keep derived business roles aligned with the owning business records';

DROP TRIGGER IF EXISTS crm_person_role_customers_sync ON public.customers;
CREATE TRIGGER crm_person_role_customers_sync
  AFTER INSERT OR UPDATE OF person_id, deleted_at OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1();

DROP TRIGGER IF EXISTS crm_person_role_recruits_sync ON public.recruit_candidates;
CREATE TRIGGER crm_person_role_recruits_sync
  AFTER INSERT OR UPDATE OF person_id, deleted_at OR DELETE ON public.recruit_candidates
  FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1();

DROP TRIGGER IF EXISTS crm_person_role_speakers_sync ON public.activity_speakers;
CREATE TRIGGER crm_person_role_speakers_sync
  AFTER INSERT OR UPDATE OF person_id, deleted_at OR DELETE ON public.activity_speakers
  FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1();

DROP TRIGGER IF EXISTS crm_person_role_participants_sync ON public.activity_participants;
CREATE TRIGGER crm_person_role_participants_sync
  AFTER INSERT OR UPDATE OF canonical_person_id, deleted_at OR DELETE ON public.activity_participants
  FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1();

DROP TRIGGER IF EXISTS crm_person_role_persons_sync ON public.persons;
CREATE TRIGGER crm_person_role_persons_sync
  AFTER UPDATE OF legacy_customer_id, deleted_at ON public.persons
  FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1();

-- 4. One-time reconciliation (exact, asserted drift; see pmc15-q2/q6 evidence) ----------
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

DELETE FROM public.person_roles WHERE id IN (703, 792);
INSERT INTO public.person_roles (person_id, role, origin)
VALUES (777, 'customer', 'derived'), (777, 'recruit', 'derived')
ON CONFLICT (person_id, role) DO NOTHING;

-- 5. crm_search_people_v1: confirmed edges only -----------------------------------------
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
        WHERE rel.deleted_at IS NULL AND rel.status = 'confirmed'
          AND (rel.from_person_id = p.id OR rel.to_person_id = p.id)
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
          WHERE r.deleted_at IS NULL AND r.status = 'confirmed'
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
  'Read-only, fixed-template Person search. Results and evidence are computed only from public CRM records; relationship templates use human-confirmed edges only';

-- 6. Boundary documentation -------------------------------------------------------------
COMMENT ON TABLE public.person_roles IS
  'Combination registry: customer/recruit/speaker/participant are derived from active business records by crm_person_roles_derive_v1 (origin=derived/legacy_backfill/manual provenance); partner/referrer/alumni/other are human-only tags. Business stage always comes from the owning business table';
COMMENT ON TABLE public.relationships IS
  'Directed Person-to-Person edge. Only human-confirmed (status=confirmed) edges feed AI/search context; pending rows are candidates from AI or legacy notes awaiting confirmation. Family roles live in household_members and insurance roles in the policy/products domain';
COMMENT ON COLUMN public.relationships.source IS
  'Where the edge came from: manual human entry, ai_suggested candidate, or legacy_note clue; provenance is retained after confirmation';
COMMENT ON COLUMN public.relationships.status IS
  'pending = unconfirmed candidate (never auto-promoted); confirmed = human-confirmed fact with confirmed_at/confirmed_by_uid';
COMMENT ON TABLE public.households IS
  'One optional lightweight family context per anchor Person; independent of relationships edges (neither is auto-generated from the other); not a policyholder/insured registry';

COMMIT;
