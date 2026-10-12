BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.person_directory_filtered_page_v1(
  p_page integer,
  p_page_size integer,
  p_keyword text,
  p_sort_field text,
  p_sort_dir text,
  p_roles text[],
  p_customer_priorities text[],
  p_recruit_priorities text[],
  p_referral_priorities text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_total bigint;
  v_pages integer;
  v_rows jsonb;
  v_order text;
  v_sort_expression text;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page > 100000
     OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 50
     OR p_roles IS NULL OR p_customer_priorities IS NULL
     OR p_recruit_priorities IS NULL OR p_referral_priorities IS NULL
     OR length(coalesce(p_keyword, '')) > 40
     OR p_sort_field NOT IN ('id','display_name','updated_at','sales_priority','recruitment_priority',
       'referral_priority','latest_followup_date','next_followup_date')
     OR p_sort_dir NOT IN ('asc','desc')
     OR cardinality(coalesce(p_roles,'{}'::text[])) > 8
     OR cardinality(coalesce(p_customer_priorities,'{}'::text[])) > 5
     OR cardinality(coalesce(p_recruit_priorities,'{}'::text[])) > 5
     OR cardinality(coalesce(p_referral_priorities,'{}'::text[])) > 5
     OR EXISTS (SELECT 1 FROM unnest(coalesce(p_roles,'{}'::text[])) r
       WHERE r NOT IN ('customer','recruit','referrer','speaker','participant','partner','alumni','other'))
     OR EXISTS (SELECT 1 FROM unnest(coalesce(p_customer_priorities,'{}'::text[])) v WHERE v NOT IN ('A','B','C','D','E'))
     OR EXISTS (SELECT 1 FROM unnest(coalesce(p_recruit_priorities,'{}'::text[])) v WHERE v NOT IN ('A','B','C','D','E'))
     OR EXISTS (SELECT 1 FROM unnest(coalesce(p_referral_priorities,'{}'::text[])) v WHERE v NOT IN ('A','B','C','D','E'))
     OR (cardinality(coalesce(p_customer_priorities,'{}'::text[])) > 0 AND NOT ('customer' = ANY(p_roles)))
     OR (cardinality(coalesce(p_recruit_priorities,'{}'::text[])) > 0 AND NOT ('recruit' = ANY(p_roles)))
     OR (cardinality(coalesce(p_referral_priorities,'{}'::text[])) > 0 AND NOT ('referrer' = ANY(p_roles)))
  THEN RAISE EXCEPTION 'Invalid filtered directory request'; END IF;

  v_sort_expression := CASE p_sort_field
    WHEN 'id' THEN 'p.id'
    WHEN 'display_name' THEN 'p.display_name'
    WHEN 'updated_at' THEN 'p.updated_at'
    WHEN 'sales_priority' THEN 'p.sales_priority'
    WHEN 'recruitment_priority' THEN 'rc.recruitment_priority'
    WHEN 'referral_priority' THEN 'p.referral_priority'
    WHEN 'latest_followup_date' THEN 'f.latest_followup_date'
    WHEN 'next_followup_date' THEN 'f.next_followup_date'
  END;
  v_order := v_sort_expression || ' ' || upper(p_sort_dir) ||
    ' NULLS LAST, p.id ' || upper(p_sort_dir);

  SELECT count(*) INTO v_total
  FROM public.persons p
  LEFT JOIN public.customers c ON c.person_id = p.id AND c.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT rc0.id, rc0.recruitment_priority FROM public.recruit_candidates rc0
    WHERE rc0.person_id = p.id AND rc0.deleted_at IS NULL ORDER BY rc0.id DESC LIMIT 1
  ) rc ON true
  WHERE p.deleted_at IS NULL
    AND (btrim(p_keyword) = '' OR position(lower(btrim(p_keyword)) in lower(p.display_name)) > 0)
    AND (cardinality(p_roles) = 0 OR EXISTS (
      SELECT 1 FROM public.person_roles pr WHERE pr.person_id = p.id AND pr.role = ANY(p_roles)))
    AND (
      (cardinality(p_customer_priorities) = 0 AND cardinality(p_recruit_priorities) = 0 AND cardinality(p_referral_priorities) = 0)
      OR (cardinality(p_customer_priorities) > 0 AND p.sales_priority = ANY(p_customer_priorities))
      OR (cardinality(p_recruit_priorities) > 0 AND rc.recruitment_priority = ANY(p_recruit_priorities))
      OR (cardinality(p_referral_priorities) > 0 AND p.referral_priority = ANY(p_referral_priorities))
    );
  v_pages := greatest(1, ceil(v_total::numeric / p_page_size)::integer);

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
        AND (cardinality($4) = 0 OR EXISTS (
          SELECT 1 FROM public.person_roles pr WHERE pr.person_id = p.id AND pr.role = ANY($4)))
        AND (
          (cardinality($5) = 0 AND cardinality($6) = 0 AND cardinality($7) = 0)
          OR (cardinality($5) > 0 AND p.sales_priority = ANY($5))
          OR (cardinality($6) > 0 AND rc.recruitment_priority = ANY($6))
          OR (cardinality($7) > 0 AND p.referral_priority = ANY($7))
        )
      ORDER BY %s LIMIT $2 OFFSET $3
    ) t
  $sql$, v_order, v_order)
  INTO v_rows USING p_keyword, p_page_size, (p_page - 1) * p_page_size,
    p_roles, p_customer_priorities, p_recruit_priorities, p_referral_priorities;

  RETURN jsonb_build_object('rows', v_rows, 'page', p_page, 'pageSize', p_page_size,
    'total', v_total, 'totalPages', v_pages, 'hasMore', p_page < v_pages,
    'sortField', p_sort_field, 'sortDir', p_sort_dir);
END
$function$;

REVOKE ALL ON FUNCTION public.person_directory_filtered_page_v1(integer,integer,text,text,text,text[],text[],text[],text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_directory_filtered_page_v1(integer,integer,text,text,text,text[],text[],text[],text[])
  TO service_role;

COMMIT;
