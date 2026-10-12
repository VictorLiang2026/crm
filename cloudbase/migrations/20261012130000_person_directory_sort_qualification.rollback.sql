BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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

COMMIT;

