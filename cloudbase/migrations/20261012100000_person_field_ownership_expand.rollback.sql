BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Lossless logical rollback for Person field ownership phase 1.
-- Keep the original canonical values on the legacy columns before dropping additions.
UPDATE public.customers c SET
  source=p.source, hobbies=p.hobbies, customer_stage=p.customer_stage,
  sales_priority=p.sales_priority, referral_priority=p.referral_priority,
  marital_status=p.marital_status, first_contact_date=p.first_contact_date
FROM public.persons p WHERE p.id=c.person_id;

UPDATE public.customers c SET recruitment_priority=rc.recruitment_priority
FROM public.recruit_candidates rc
WHERE rc.person_id=c.person_id AND rc.recruitment_priority IS NOT NULL;

UPDATE public.activity_speakers s SET
  phone=p.phone, wechat=p.wechat, organization=p.organization, source=p.source
FROM public.persons p WHERE p.id=s.person_id;

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.recruit_candidates rc
    JOIN public.recruit_milestones m ON m.candidate_id=rc.id
    WHERE m.note='自动承接客户表招募优先级（迁移 20261012100000）'
      AND (rc.stage<>'新增人才' OR rc.updated_at<>rc.created_at
        OR EXISTS (SELECT 1 FROM public.recruit_followups rf WHERE rf.candidate_id=rc.id)
        OR EXISTS (SELECT 1 FROM public.activity_speakers s WHERE s.recruit_candidate_id=rc.id))
  ) THEN
    RAISE EXCEPTION 'Migration-created recruit records have business changes; review before rollback';
  END IF;
  WITH marked AS (
    DELETE FROM public.recruit_milestones m
    WHERE m.note='自动承接客户表招募优先级（迁移 20261012100000）'
    RETURNING m.candidate_id
  )
  DELETE FROM public.recruit_candidates rc USING marked
  WHERE rc.id=marked.candidate_id;
END
$rollback$;

DROP FUNCTION IF EXISTS public.person_trash_page_v1(integer,integer,text[],text[],text[],text[]);

ALTER TABLE public.recruit_candidates DROP COLUMN IF EXISTS recruitment_priority;
ALTER TABLE public.persons
  DROP COLUMN IF EXISTS hobbies,
  DROP COLUMN IF EXISTS customer_stage,
  DROP COLUMN IF EXISTS sales_priority,
  DROP COLUMN IF EXISTS referral_priority,
  DROP COLUMN IF EXISTS marital_status,
  DROP COLUMN IF EXISTS first_contact_date;

DROP INDEX IF EXISTS public.idx_recruit_candidates_priority_active;
DROP INDEX IF EXISTS public.idx_persons_sales_priority_active;
DROP INDEX IF EXISTS public.idx_persons_referral_priority_active;

CREATE OR REPLACE FUNCTION public.person_directory_page_v1(p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_keyword text DEFAULT ''::text, p_sort_field text DEFAULT 'id'::text, p_sort_dir text DEFAULT 'desc'::text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_total bigint; v_pages integer; v_rows jsonb; v_order text;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_page IS NULL OR p_page<1 OR p_page>100000
     OR p_page_size IS NULL OR p_page_size<1 OR p_page_size>50
     OR length(coalesce(p_keyword,''))>40
     OR p_sort_field NOT IN ('id','display_name','updated_at','sales_priority','customer_stage','latest_followup_date','next_followup_date')
     OR p_sort_dir NOT IN ('asc','desc')
  THEN RAISE EXCEPTION 'Invalid directory request'; END IF;
  SELECT count(*) INTO v_total FROM public.persons p
  WHERE p.deleted_at IS NULL AND (btrim(p_keyword)='' OR position(lower(btrim(p_keyword)) in lower(p.display_name))>0);
  v_pages:=greatest(1,ceil(v_total::numeric/p_page_size)::integer);
  v_order:=format('%I %s NULLS LAST, id %s',p_sort_field,upper(p_sort_dir),upper(p_sort_dir));
  EXECUTE format($sql$
    SELECT coalesce(jsonb_agg(to_jsonb(t)-'_ordinal' ORDER BY t._ordinal),'[]'::jsonb)
    FROM (
      SELECT row_number() OVER (ORDER BY %s) AS _ordinal,
        p.id,p.display_name,p.occupation,p.organization,p.updated_at,
        c."Id" AS customer_id,p.display_name AS customer_name,c.sales_priority,c.customer_stage,
        f.followup_date AS latest_followup_date,f.next_followup_date,
        (SELECT coalesce(jsonb_agg(pr.role ORDER BY pr.role),'[]'::jsonb)
         FROM public.person_roles pr WHERE pr.person_id=p.id) AS roles,
        (SELECT rc.id FROM public.recruit_candidates rc WHERE rc.person_id=p.id AND rc.deleted_at IS NULL ORDER BY rc.id LIMIT 1) AS recruit_id
      FROM public.persons p
      LEFT JOIN public.customers c ON c.person_id=p.id AND c.deleted_at IS NULL
      LEFT JOIN LATERAL (SELECT x.followup_date,x.next_followup_date FROM public.followups x
        WHERE x.customer_id=c."Id" AND x.deleted_at IS NULL
        ORDER BY x.followup_date DESC NULLS LAST,x."Id" DESC LIMIT 1) f ON true
      WHERE p.deleted_at IS NULL AND (btrim($1)='' OR position(lower(btrim($1)) in lower(p.display_name))>0)
      ORDER BY %s LIMIT $2 OFFSET $3
    ) t
  $sql$,v_order,v_order) INTO v_rows USING p_keyword,p_page_size,(p_page-1)*p_page_size;
  RETURN jsonb_build_object('rows',v_rows,'page',p_page,'pageSize',p_page_size,'total',v_total,
    'totalPages',v_pages,'hasMore',p_page<v_pages,'sortField',p_sort_field,'sortDir',p_sort_dir);
END
$function$;

COMMIT;
