-- PMC-20 compatibility fix: crm_search_people_v1 referenced dropped persons.legacy_customer_id
-- (CL-03) in all three templates, so every RPC call failed. Customer is now resolved through
-- customers.person_id (backfilled/constrained PMC-17). Output field legacy_customer_id is
-- renamed customer_id; the only cloud consumer (assistant/search-service.js) maps rows by
-- person_id and never read legacy_customer_id.
CREATE OR REPLACE FUNCTION public.crm_search_people_v1(p_template text, p_months integer DEFAULT 3, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      SELECT p.id AS person_id, p.display_name, c."Id" AS customer_id,
        ap.id AS participant_id, a.id AS activity_id, a.activity_date,
        ap.followup_status,
        row_number() OVER (PARTITION BY p.id ORDER BY a.activity_date DESC, ap.id DESC) AS rn
      FROM public.persons p
      LEFT JOIN public.customers c ON c.person_id = p.id AND c.deleted_at IS NULL
      JOIN public.activity_participants ap ON
        ap.canonical_person_id = p.id OR
        (ap.canonical_person_id IS NULL AND
          ((ap.person_type = 'person' AND ap.person_id = p.id)
           OR (ap.person_type = 'customer' AND ap.person_id = c."Id")
           OR (ap.person_type = 'recruit' AND EXISTS (
             SELECT 1 FROM public.recruit_candidates rc
             WHERE rc.id = ap.person_id AND rc.person_id = p.id AND rc.deleted_at IS NULL))))
      JOIN public.activities a ON a.id = ap.activity_id
      WHERE p.deleted_at IS NULL AND ap.deleted_at IS NULL AND a.deleted_at IS NULL
        AND ap.status = 'attended'
        AND a.activity_date >= (local_today - make_interval(months => p_months))::date
        AND a.activity_date <= local_today
        AND (c."Id" IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM public.customers cx WHERE cx.person_id = p.id))
    ), matched AS (
      SELECT x.* FROM attendance x WHERE x.rn = 1
        AND x.followup_status IS DISTINCT FROM 'done'
        AND NOT EXISTS (SELECT 1 FROM public.followups f
          WHERE f.customer_id = x.customer_id AND f.deleted_at IS NULL
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
        SELECT person_id, display_name, customer_id, activity_id,
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
      SELECT p.id AS person_id, p.display_name, c."Id" AS customer_id,
        child.member_id AS child_member_id, edu.source_table AS education_source_table,
        edu.source_id AS education_source_id, edu.observed_at AS education_date
      FROM public.persons p
      LEFT JOIN public.customers c ON c.person_id = p.id AND c.deleted_at IS NULL
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
          FROM public.followups f WHERE f.customer_id = c."Id"
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
        AND (c."Id" IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM public.customers cx WHERE cx.person_id = p.id))
        AND NOT EXISTS (SELECT 1 FROM public.followups f
          WHERE f.customer_id = c."Id" AND f.deleted_at IS NULL
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
          WHERE prr.customer_id = c."Id" AND prr.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM public.products product
          WHERE product.customer_id = c."Id" AND product.deleted_at IS NULL)
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
      SELECT p.id AS person_id, p.display_name, c."Id" AS customer_id,
        c.sales_priority::text AS sales_priority,
        r.id AS relationship_id, r.from_person_id, r.to_person_id,
        r.trend, r.updated_at AS relationship_updated_at
      FROM public.persons p
      JOIN public.customers c ON c.person_id = p.id AND c.deleted_at IS NULL
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
