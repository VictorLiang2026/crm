BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Person field ownership phase 1 (expand/backfill).
-- This migration is public-only and intentionally keeps legacy columns until
-- application functions and pages have been deployed and the contract phase runs.

ALTER TABLE public.persons
  ADD COLUMN IF NOT EXISTS hobbies text,
  ADD COLUMN IF NOT EXISTS customer_stage public."客户经营阶段",
  ADD COLUMN IF NOT EXISTS sales_priority public."优先级",
  ADD COLUMN IF NOT EXISTS referral_priority public."优先级",
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS first_contact_date date;

ALTER TABLE public.recruit_candidates
  ADD COLUMN IF NOT EXISTS recruitment_priority public."优先级";

-- Person values are canonical. Fill only blanks, customer first, then linked speaker.
UPDATE public.persons p SET
  source = COALESCE(NULLIF(btrim(p.source), ''), NULLIF(btrim(c.source), '')),
  hobbies = COALESCE(NULLIF(btrim(p.hobbies), ''), NULLIF(btrim(c.hobbies), '')),
  customer_stage = COALESCE(p.customer_stage, c.customer_stage),
  sales_priority = COALESCE(p.sales_priority, c.sales_priority),
  referral_priority = COALESCE(p.referral_priority, c.referral_priority),
  marital_status = COALESCE(NULLIF(btrim(p.marital_status), ''), NULLIF(btrim(c.marital_status), '')),
  first_contact_date = COALESCE(p.first_contact_date, c.first_contact_date),
  updated_at = now()
FROM public.customers c
WHERE c.person_id = p.id
  AND (NULLIF(btrim(p.source), '') IS NULL AND NULLIF(btrim(c.source), '') IS NOT NULL
    OR NULLIF(btrim(p.hobbies), '') IS NULL AND NULLIF(btrim(c.hobbies), '') IS NOT NULL
    OR p.customer_stage IS NULL AND c.customer_stage IS NOT NULL
    OR p.sales_priority IS NULL AND c.sales_priority IS NOT NULL
    OR p.referral_priority IS NULL AND c.referral_priority IS NOT NULL
    OR NULLIF(btrim(p.marital_status), '') IS NULL AND NULLIF(btrim(c.marital_status), '') IS NOT NULL
    OR p.first_contact_date IS NULL AND c.first_contact_date IS NOT NULL);

UPDATE public.persons p SET
  phone = COALESCE(NULLIF(btrim(p.phone), ''), NULLIF(btrim(s.phone), '')),
  wechat = COALESCE(NULLIF(btrim(p.wechat), ''), NULLIF(btrim(s.wechat), '')),
  organization = COALESCE(NULLIF(btrim(p.organization), ''), NULLIF(btrim(s.organization), '')),
  source = COALESCE(NULLIF(btrim(p.source), ''), NULLIF(btrim(s.source), '')),
  updated_at = now()
FROM public.activity_speakers s
WHERE s.person_id = p.id
  AND (NULLIF(btrim(p.phone), '') IS NULL AND NULLIF(btrim(s.phone), '') IS NOT NULL
    OR NULLIF(btrim(p.wechat), '') IS NULL AND NULLIF(btrim(s.wechat), '') IS NOT NULL
    OR NULLIF(btrim(p.organization), '') IS NULL AND NULLIF(btrim(s.organization), '') IS NOT NULL
    OR NULLIF(btrim(p.source), '') IS NULL AND NULLIF(btrim(s.source), '') IS NOT NULL);

-- Carry legacy recruitment priorities to every matched record, including the one
-- already deleted record. Deleted candidates remain deleted.
UPDATE public.recruit_candidates rc SET recruitment_priority = c.recruitment_priority
FROM public.customers c
WHERE c.person_id = rc.person_id
  AND c.recruitment_priority IS NOT NULL;

-- Preserve all 558 priorities that had no recruit record. The marker in the first
-- milestone makes these rows identifiable for rollback. Customer rows stay active.
WITH missing AS (
  SELECT c."Id" AS customer_id, c.person_id, p.display_name,
         c.recruitment_priority, c.deleted_at AS customer_deleted_at,
         now() AS migrated_at
  FROM public.customers c
  JOIN public.persons p ON p.id = c.person_id
  WHERE c.recruitment_priority IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.recruit_candidates rc
      WHERE rc.person_id = c.person_id
    )
), inserted AS (
  INSERT INTO public.recruit_candidates
    (customer_id, person_id, recruitment_priority, stage, stage_changed_at, created_at, updated_at, deleted_at)
  SELECT customer_id, person_id, recruitment_priority, '新增人才', migrated_at, migrated_at, migrated_at,
         customer_deleted_at
  FROM missing
  RETURNING id, person_id, customer_id, recruitment_priority, stage, created_at
)
INSERT INTO public.recruit_milestones(candidate_id, from_stage, to_stage, happened_at, note, created_at)
SELECT i.id, NULL, i.stage, i.created_at,
       '自动承接客户表招募优先级（迁移 20261012100000）', i.created_at
FROM inserted i;

CREATE INDEX IF NOT EXISTS idx_recruit_candidates_priority_active
  ON public.recruit_candidates (recruitment_priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_persons_sales_priority_active
  ON public.persons (sales_priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_persons_referral_priority_active
  ON public.persons (referral_priority) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.person_directory_page_v1(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_keyword text DEFAULT ''::text,
  p_sort_field text DEFAULT 'id'::text,
  p_sort_dir text DEFAULT 'desc'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_total bigint; v_pages integer; v_rows jsonb; v_order text;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page > 100000
     OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 50
     OR length(coalesce(p_keyword, '')) > 40
     OR p_sort_field NOT IN ('id','display_name','updated_at','sales_priority','recruitment_priority',
       'referral_priority','latest_followup_date','next_followup_date')
     OR p_sort_dir NOT IN ('asc','desc')
  THEN RAISE EXCEPTION 'Invalid directory request'; END IF;
  SELECT count(*) INTO v_total FROM public.persons p
  WHERE p.deleted_at IS NULL
    AND (btrim(p_keyword) = '' OR position(lower(btrim(p_keyword)) in lower(p.display_name)) > 0);
  v_pages := greatest(1, ceil(v_total::numeric / p_page_size)::integer);
  v_order := format('%I %s NULLS LAST, id %s', p_sort_field, upper(p_sort_dir), upper(p_sort_dir));
  EXECUTE format($sql$
    SELECT coalesce(jsonb_agg(to_jsonb(t)-'_ordinal' ORDER BY t._ordinal), '[]'::jsonb)
    FROM (
      SELECT row_number() OVER (ORDER BY %s) AS _ordinal,
        p.id, p.display_name, p.phone, p.occupation, p.organization, p.updated_at,
        p.sales_priority, rc.recruitment_priority, p.referral_priority,
        c."Id" AS customer_id, p.display_name AS customer_name,
        f.latest_followup_date, f.next_followup_date,
        (SELECT coalesce(jsonb_agg(pr.role ORDER BY pr.role), '[]'::jsonb)
         FROM public.person_roles pr WHERE pr.person_id = p.id) AS roles,
        rc.id AS recruit_id
      FROM public.persons p
      LEFT JOIN public.customers c ON c.person_id = p.id AND c.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT rc0.id, rc0.recruitment_priority
        FROM public.recruit_candidates rc0
        WHERE rc0.person_id = p.id AND rc0.deleted_at IS NULL
        ORDER BY rc0.id DESC LIMIT 1
      ) rc ON true
      LEFT JOIN LATERAL (
        SELECT max(x.followup_date) AS latest_followup_date,
               min(x.next_date) FILTER (WHERE x.next_date >= CURRENT_DATE) AS next_followup_date
        FROM (
          SELECT cf.followup_date, cf.next_followup_date AS next_date
          FROM public.followups cf
          WHERE c."Id" IS NOT NULL AND cf.customer_id = c."Id" AND cf.deleted_at IS NULL
          UNION ALL
          SELECT rf.followup_date, rf.next_followup_date AS next_date
          FROM public.recruit_followups rf
          WHERE rc.id IS NOT NULL AND rf.candidate_id = rc.id AND rf.deleted_at IS NULL
        ) x
      ) f ON true
      WHERE p.deleted_at IS NULL
        AND (btrim($1) = '' OR position(lower(btrim($1)) in lower(p.display_name)) > 0)
      ORDER BY %s LIMIT $2 OFFSET $3
    ) t
  $sql$, v_order, v_order)
  INTO v_rows USING p_keyword, p_page_size, (p_page - 1) * p_page_size;
  RETURN jsonb_build_object('rows', v_rows, 'page', p_page, 'pageSize', p_page_size,
    'total', v_total, 'totalPages', v_pages, 'hasMore', p_page < v_pages,
    'sortField', p_sort_field, 'sortDir', p_sort_dir);
END
$function$;

CREATE OR REPLACE FUNCTION public.person_trash_page_v1(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_roles text[] DEFAULT ARRAY[]::text[],
  p_customer_priorities text[] DEFAULT ARRAY[]::text[],
  p_recruit_priorities text[] DEFAULT ARRAY[]::text[],
  p_referral_priorities text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_total bigint; v_pages integer; v_rows jsonb;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page > 100000
     OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 50
     OR coalesce(cardinality(p_roles), 0) > 8
     OR coalesce(cardinality(p_customer_priorities), 0) > 5
     OR coalesce(cardinality(p_recruit_priorities), 0) > 5
     OR coalesce(cardinality(p_referral_priorities), 0) > 5
     OR EXISTS (SELECT 1 FROM unnest(coalesce(p_roles, ARRAY[]::text[])) r
       WHERE r NOT IN ('customer','recruit','referrer','speaker','participant','partner','alumni','other'))
     OR EXISTS (SELECT 1 FROM unnest(coalesce(p_customer_priorities, ARRAY[]::text[]) ||
       coalesce(p_recruit_priorities, ARRAY[]::text[]) || coalesce(p_referral_priorities, ARRAY[]::text[])) v
       WHERE v NOT IN ('A','B','C','D','E'))
  THEN RAISE EXCEPTION 'Invalid person trash filter'; END IF;
  WITH eligible AS (
    SELECT p.id, p.display_name, p.occupation, p.organization, p.updated_at, p.deleted_at,
      c."Id" AS customer_id, c.deleted_at AS customer_deleted,
      rc.id AS recruit_id, rc.recruitment_priority,
      p.sales_priority, p.referral_priority,
      coalesce((SELECT array_agg(pr.role ORDER BY pr.role) FROM public.person_roles pr WHERE pr.person_id=p.id), ARRAY[]::text[]) AS roles
    FROM public.persons p
    LEFT JOIN public.customers c ON c.person_id=p.id
    LEFT JOIN LATERAL (SELECT r.id,r.recruitment_priority FROM public.recruit_candidates r
      WHERE r.person_id=p.id ORDER BY r.id DESC LIMIT 1) rc ON true
    WHERE p.deleted_at IS NOT NULL
  ), filtered AS (
    SELECT e.* FROM eligible e
    WHERE coalesce(cardinality(p_roles),0)=0 OR (
      ('customer'=ANY(p_roles) AND 'customer'=ANY(e.roles)
        AND (coalesce(cardinality(p_customer_priorities),0)=0 OR e.sales_priority::text=ANY(p_customer_priorities)))
      OR ('recruit'=ANY(p_roles) AND 'recruit'=ANY(e.roles)
        AND (coalesce(cardinality(p_recruit_priorities),0)=0 OR e.recruitment_priority::text=ANY(p_recruit_priorities)))
      OR ('referrer'=ANY(p_roles) AND 'referrer'=ANY(e.roles)
        AND (coalesce(cardinality(p_referral_priorities),0)=0 OR e.referral_priority::text=ANY(p_referral_priorities)))
      OR EXISTS (SELECT 1 FROM unnest(p_roles) r WHERE r NOT IN ('customer','recruit','referrer') AND r=ANY(e.roles))
    )
  )
  SELECT count(*) INTO v_total FROM filtered;
  v_pages := greatest(1, ceil(v_total::numeric / p_page_size)::integer);
  WITH eligible AS (
    SELECT p.id, p.display_name, p.occupation, p.organization, p.updated_at, p.deleted_at, p.delete_batch_id,
      c."Id" AS customer_id, c.deleted_at AS customer_deleted,
      rc.id AS recruit_id, p.sales_priority, rc.recruitment_priority, p.referral_priority,
      coalesce((SELECT array_agg(pr.role ORDER BY pr.role) FROM public.person_roles pr WHERE pr.person_id=p.id), ARRAY[]::text[]) AS roles
    FROM public.persons p
    LEFT JOIN public.customers c ON c.person_id=p.id
    LEFT JOIN LATERAL (SELECT r.id,r.recruitment_priority FROM public.recruit_candidates r
      WHERE r.person_id=p.id ORDER BY r.id DESC LIMIT 1) rc ON true
    WHERE p.deleted_at IS NOT NULL
  ), filtered AS (
    SELECT e.* FROM eligible e
    WHERE coalesce(cardinality(p_roles),0)=0 OR (
      ('customer'=ANY(p_roles) AND 'customer'=ANY(e.roles)
        AND (coalesce(cardinality(p_customer_priorities),0)=0 OR e.sales_priority::text=ANY(p_customer_priorities)))
      OR ('recruit'=ANY(p_roles) AND 'recruit'=ANY(e.roles)
        AND (coalesce(cardinality(p_recruit_priorities),0)=0 OR e.recruitment_priority::text=ANY(p_recruit_priorities)))
      OR ('referrer'=ANY(p_roles) AND 'referrer'=ANY(e.roles)
        AND (coalesce(cardinality(p_referral_priorities),0)=0 OR e.referral_priority::text=ANY(p_referral_priorities)))
      OR EXISTS (SELECT 1 FROM unnest(p_roles) r WHERE r NOT IN ('customer','recruit','referrer') AND r=ANY(e.roles))
    )
  )
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.deleted_at DESC, t.id DESC), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT f.*, (f.delete_batch_id IS NOT NULL) AS batch_scoped
      FROM filtered f ORDER BY f.deleted_at DESC, f.id DESC
      LIMIT p_page_size OFFSET (p_page - 1) * p_page_size
    ) t;
  RETURN jsonb_build_object('rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,
    'totalPages',v_pages,'hasMore',p_page<v_pages);
END
$function$;

REVOKE ALL ON FUNCTION public.person_trash_page_v1(integer,integer,text[],text[],text[],text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.person_trash_page_v1(integer,integer,text[],text[],text[],text[]) TO anon, authenticated, service_role;

COMMIT;
