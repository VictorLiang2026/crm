BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- L01 additive, read-only customer worklist. Existing directory RPCs remain unchanged.
CREATE FUNCTION public.person_customer_worklist_v1(p_criteria jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_page integer := (p_criteria->>'page')::integer;
  v_size integer := (p_criteria->>'pageSize')::integer;
  v_keyword text := p_criteria->>'keyword';
  v_field text := p_criteria->>'sortField';
  v_dir text := p_criteria->>'sortDir';
  v_status text := p_criteria->>'status';
  v_priorities jsonb := p_criteria->'customerPriorities';
  v_today date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  v_result jsonb;
  v_order text;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF jsonb_typeof(p_criteria) IS DISTINCT FROM 'object'
    OR v_page IS NULL OR v_page NOT BETWEEN 1 AND 1000
    OR v_size IS NULL OR v_size NOT BETWEEN 1 AND 50
    OR v_keyword IS NULL OR length(v_keyword)>40
    OR v_field IS NULL OR v_field NOT IN ('id','display_name','updated_at','sales_priority',
      'recruitment_priority','referral_priority','latest_followup_date','next_followup_date','wb_status')
    OR v_dir IS NULL OR v_dir NOT IN ('asc','desc')
    OR v_status IS NULL OR v_status NOT IN ('all','overdue','today','month','stale','normal','unknown','unlinked')
    OR jsonb_typeof(v_priorities) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid customer worklist criteria'; END IF;
  IF jsonb_array_length(v_priorities)>5 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_priorities) AS x(value)
    WHERE value IS NULL OR value NOT IN ('A','B','C','D','E')
  ) THEN RAISE EXCEPTION 'Invalid customer priorities'; END IF;
  -- Identifiers and direction are allowlisted above; all filter values are bound.
  v_order := format('%I %s NULLS LAST, id ASC',
    CASE WHEN v_field='wb_status' THEN 'wb_sort' ELSE v_field END, upper(v_dir));
  EXECUTE format($query$
    WITH base AS (
      SELECT p.id,p.display_name,p.updated_at,p.customer_stage,p.sales_priority,
        p.referral_priority,rc.recruitment_priority,c."Id" AS customer_id,
        rc.id AS recruit_id,rc.stage AS recruit_stage,
        CASE WHEN rc.id IS NOT NULL THEN 'active'
          WHEN EXISTS(SELECT 1 FROM public.recruit_candidates old_rc
            WHERE old_rc.deleted_at IS NOT NULL AND
              (old_rc.person_id=p.id OR (old_rc.person_id IS NULL AND old_rc.customer_id=c."Id")))
            THEN 'historical' ELSE 'none' END AS recruit_status,
        (SELECT coalesce(jsonb_agg(r.role ORDER BY r.role),'[]'::jsonb)
          FROM public.person_roles r WHERE r.person_id=p.id) AS roles,
        f.followup_date AS latest_followup_date,f.next_followup_date,
        coalesce(f.followup_date,p.first_contact_date,(c.created_at AT TIME ZONE 'UTC')::date) AS last_contact_date
      FROM public.persons p
      LEFT JOIN LATERAL (
        SELECT c0."Id",c0.created_at FROM public.customers c0
        WHERE c0.person_id=p.id AND c0.deleted_at IS NULL ORDER BY c0."Id" DESC LIMIT 1
      ) c ON true
      LEFT JOIN LATERAL (
        SELECT rc0.id,rc0.stage,rc0.recruitment_priority FROM public.recruit_candidates rc0
        WHERE rc0.deleted_at IS NULL AND
          (rc0.person_id=p.id OR (rc0.person_id IS NULL AND rc0.customer_id=c."Id"))
        ORDER BY rc0.id DESC LIMIT 1
      ) rc ON true
      LEFT JOIN LATERAL (
        SELECT x.followup_date,x.next_followup_date FROM public.followups x
        WHERE x.customer_id=c."Id" AND x.deleted_at IS NULL
        ORDER BY x.followup_date DESC NULLS LAST,x."Id" DESC LIMIT 1
      ) f ON true
      WHERE p.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM public.person_roles r WHERE r.person_id=p.id AND r.role='customer')
        AND ($1='' OR strpos(lower(p.display_name),lower($1))>0)
        AND (jsonb_array_length($2)=0 OR $2 ? p.sales_priority::text)
    ), scored AS (
      SELECT base.*,
        CASE WHEN customer_id IS NULL THEN 'unlinked'
          WHEN next_followup_date<$3 THEN 'overdue'
          WHEN next_followup_date=$3 THEN 'today'
          WHEN next_followup_date<=$3+30 THEN 'month'
          WHEN $3-last_contact_date>=30 THEN 'stale'
          WHEN last_contact_date IS NULL AND next_followup_date IS NULL THEN 'unknown'
          ELSE 'normal' END AS wb_status,
        CASE WHEN customer_id IS NULL THEN 700000
          WHEN next_followup_date<$3 THEN 100000-($3-next_followup_date)
          WHEN next_followup_date=$3 THEN 200000
          WHEN next_followup_date<=$3+30 THEN 300000+(next_followup_date-$3)
          WHEN $3-last_contact_date>=30 THEN 400000-($3-last_contact_date)
          WHEN last_contact_date IS NULL AND next_followup_date IS NULL THEN 600000
          WHEN next_followup_date IS NOT NULL THEN 500000+(next_followup_date-$3)
          ELSE 500000 END AS wb_sort
      FROM base
    ), filtered AS (
      SELECT * FROM scored WHERE $4='all' OR wb_status=$4
    ), ordered AS (
      SELECT *,row_number() OVER(ORDER BY %s) AS ordinal FROM filtered
    )
    SELECT jsonb_build_object(
      'rows',coalesce((SELECT jsonb_agg(to_jsonb(x)-'ordinal'-'wb_sort' ORDER BY ordinal)
        FROM(SELECT * FROM ordered ORDER BY ordinal LIMIT $5 OFFSET $6)x),'[]'::jsonb),
      'total',(SELECT count(*) FROM filtered))
  $query$,v_order)
  INTO v_result USING btrim(v_keyword),v_priorities,v_today,v_status,v_size,(v_page-1)*v_size;
  RETURN v_result || jsonb_build_object('page',v_page,'pageSize',v_size,
    'totalPages',greatest(1,ceil((v_result->>'total')::numeric/v_size)::integer),
    'hasMore',v_page*v_size<(v_result->>'total')::bigint,
    'sortField',v_field,'sortDir',v_dir,'asOfDate',v_today,'timezone','Asia/Shanghai');
END
$function$;
REVOKE ALL ON FUNCTION public.person_customer_worklist_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.person_customer_worklist_v1(jsonb) TO service_role;
COMMIT;
