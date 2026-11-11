BEGIN;
DO $guard$ BEGIN
  IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid='public.crm_opportunity_directory_v1(text,integer,integer,text,text,text,bigint,text)'::regprocedure) IS DISTINCT FROM '4372fa03275b8855531302635bd0a6fb' THEN RAISE EXCEPTION 'Opportunity directory changed'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.crm_opportunity_directory_v1(p_actor_uid text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20, p_kind text DEFAULT 'all'::text, p_status text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_person_id bigint DEFAULT NULL::bigint, p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_kind IN ('protection','recruitment','due','records') THEN
    IF current_user <> 'service_role' OR nullif(btrim(p_actor_uid),'') IS NULL OR length(p_actor_uid)>128 OR
       p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 50 OR
       (p_person_id IS NOT NULL AND p_person_id<1) OR length(coalesce(p_query,''))>120 OR length(coalesce(p_status,''))>40 OR length(coalesce(p_type,''))>40 THEN
      RAISE EXCEPTION 'Invalid pipeline directory query' USING ERRCODE='22023';
    END IF;
    WITH business AS (
      SELECT o.id, o.customer_id, coalesce(o.person_id,c.person_id) AS person_id, 'opportunity' AS entity,
        CASE WHEN o.opportunity_type IN ('insurance','医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障') THEN 'protection' ELSE 'review' END AS track,
        o.opportunity_type AS record_type,o.status AS raw_stage,
        CASE WHEN o.opportunity_type IN ('insurance','医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障') THEN
          CASE WHEN o.status='发现' THEN '需求线索' WHEN o.status='成交' THEN '已成交'
               WHEN o.status IN ('需求线索','需求已核实','保障分析','方案沟通','等待决定','已成交','暂缓','未达成') THEN o.status END END AS mapped_stage,
        o.status IN ('成交','关闭','已成交','暂缓','未达成') AS terminal,
        o.updated_at,CASE WHEN work.id IS NULL THEN o.next_action WHEN work.status IN ('open','in_progress') THEN work.title END AS next_action,
        CASE WHEN work.id IS NULL THEN o.next_action_date WHEN work.status IN ('open','in_progress') THEN (work.due_at AT TIME ZONE 'Asia/Shanghai')::date END AS next_date,work.id AS action_id,work.status AS action_status
      FROM public.opportunities o
      LEFT JOIN public.customers c ON c."Id"=o.customer_id AND c.deleted_at IS NULL
      LEFT JOIN public.v_next_context_action work ON work.kind='opportunity' AND work.target_id=o.id AND work.person_id=coalesce(o.person_id,c.person_id)
      WHERE o.deleted_at IS NULL AND (o.customer_id IS NULL OR c."Id" IS NOT NULL)
      UNION ALL
      SELECT r.id,r.customer_id,r.person_id,'candidate','recruitment','recruit',r.stage,
        CASE WHEN r.stage='签约入司' THEN '已加入'
             WHEN r.stage IN ('关系建立','兴趣了解','双向评估','职业沟通','决策跟进','已加入','继续培养','暂不推进') THEN r.stage END,
        r.stage IN ('签约入司','流失','已加入','继续培养','暂不推进'),
        r.updated_at,CASE WHEN work.id IS NULL THEN r.next_action WHEN work.status IN ('open','in_progress') THEN work.title END,
        CASE WHEN work.id IS NULL THEN r.next_action_date WHEN work.status IN ('open','in_progress') THEN (work.due_at AT TIME ZONE 'Asia/Shanghai')::date END,work.id,work.status
      FROM public.recruit_candidates r LEFT JOIN public.v_next_context_action work ON work.kind='candidate' AND work.target_id=r.id AND work.person_id=r.person_id WHERE r.deleted_at IS NULL
    ), judged AS (
      SELECT b.*,d.confirmed_at,d.source AS declared_source,
        CASE WHEN b.track='recruitment' OR d.native_after=b.raw_stage THEN d.stage END AS confirmed_stage
      FROM business b LEFT JOIN LATERAL (
        SELECT d.stage,d.source,d.confirmed_at,d.native_after FROM public.crm_pipeline_decisions d
        WHERE d.confirmed_at IS NOT NULL AND d.person_id=b.person_id AND
          ((b.entity='opportunity' AND d.protection_id=b.id) OR (b.entity='candidate' AND d.recruit_id=b.id))
        ORDER BY d.confirmed_at DESC,d.id DESC LIMIT 1
      ) d ON true
    ), scoped AS (
      SELECT b.*,p.display_name AS person_name,coalesce(b.confirmed_stage,b.mapped_stage,b.raw_stage) AS stage,
        CASE WHEN b.confirmed_stage IS NULL THEN b.terminal ELSE b.confirmed_stage IN ('已成交','暂缓','未达成','已加入','继续培养','暂不推进') END AS is_closed
      FROM judged b JOIN public.persons p ON p.id=b.person_id AND p.deleted_at IS NULL
      WHERE (p_kind NOT IN ('protection','recruitment') OR b.track=p_kind)
        AND (p_kind<>'due' OR b.next_date <= (now() AT TIME ZONE 'Asia/Shanghai')::date)
        AND (p_person_id IS NULL OR p.id=p_person_id)
        AND (p_type IS NULL OR b.record_type=p_type OR
          (p_type='source_referral' AND (b.declared_source='referral' OR b.record_type IN ('referral','转介绍'))))
        AND (p_query IS NULL OR strpos(lower(concat_ws(' ',p.display_name,b.raw_stage,b.record_type,b.next_action)),lower(btrim(p_query)))>0)
    ), filtered AS MATERIALIZED (
      SELECT * FROM scoped WHERE (p_kind<>'due' OR NOT is_closed) AND (p_status IS NULL OR (p_status='active' AND NOT is_closed) OR
        (p_status='terminal' AND is_closed) OR (p_status='review' AND coalesce(confirmed_stage,mapped_stage) IS NULL) OR stage=p_status)
    ), page_rows AS (
      SELECT * FROM filtered ORDER BY CASE WHEN p_kind='due' THEN next_date END ASC NULLS LAST,
        updated_at DESC NULLS LAST,entity,id DESC LIMIT p_page_size OFFSET (p_page-1)*p_page_size
    )
    SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY CASE WHEN p_kind='due' THEN next_date END ASC NULLS LAST,
        updated_at DESC NULLS LAST,entity,id DESC) FROM page_rows x),'[]'::jsonb),
      'total',count(*),'hasMore',count(*)>p_page*p_page_size,'page',p_page,'pageSize',p_page_size) INTO v_result FROM filtered;
    RETURN v_result;
  END IF;
  IF current_user <> 'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR
     p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000 OR
     p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 50 OR
     p_kind IS NULL OR p_kind NOT IN ('all','person','customer') OR
     (p_status IS NOT NULL AND p_status NOT IN
       ('active','terminal','发现','沟通','方案','成交','关闭','潜在线索','已介绍','已联系','已建立关系')) OR
     (p_type IS NOT NULL AND p_type NOT IN
       ('医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障','转介绍',
        'insurance','recruit','referral','activity','speaker','partnership','service','relationship')) OR
     (p_person_id IS NOT NULL AND p_person_id < 1) OR
     (p_query IS NOT NULL AND length(btrim(p_query)) NOT BETWEEN 1 AND 120) THEN
    RAISE EXCEPTION 'Invalid Opportunity directory query' USING ERRCODE='22023';
  END IF;

  WITH scoped AS MATERIALIZED (
    SELECT o.id, o.person_id, o.customer_id, o.opportunity_type, o.status,
      o.discovered_at, o.last_progress, o.next_action, o.next_action_date,
      o.ai_summary, o.referred_name, o.referred_relation, o.created_at, o.updated_at,
      CASE WHEN o.customer_id IS NULL THEN 'person' ELSE 'customer' END AS source_kind,
      COALESCE(p.id, cp.id) AS resolved_person_id,
      COALESCE(p.display_name, cp.display_name) AS person_name,
      CASE WHEN o.customer_id IS NOT NULL THEN c."Id" ELSE NULL END AS resolved_customer_id
    FROM public.opportunities o
    LEFT JOIN public.persons p ON p.id=o.person_id AND p.deleted_at IS NULL
    LEFT JOIN public.customers c ON c."Id"=o.customer_id AND c.deleted_at IS NULL
    LEFT JOIN public.persons cp ON cp.id=c.person_id AND cp.deleted_at IS NULL
    WHERE o.deleted_at IS NULL
      AND (p_kind='all' OR (p_kind='person' AND o.customer_id IS NULL) OR
        (p_kind='customer' AND o.customer_id IS NOT NULL))
      AND (p_type IS NULL OR o.opportunity_type=p_type)
      AND (p_person_id IS NULL OR COALESCE(p.id,cp.id)=p_person_id)
      AND (p_query IS NULL OR
        COALESCE(p.display_name,cp.display_name,'') ILIKE '%'||btrim(p_query)||'%' OR
        COALESCE(o.opportunity_type,'') ILIKE '%'||btrim(p_query)||'%' OR
        COALESCE(o.last_progress,'') ILIKE '%'||btrim(p_query)||'%' OR
        COALESCE(o.next_action,'') ILIKE '%'||btrim(p_query)||'%')
  ), filtered AS MATERIALIZED (
    SELECT * FROM scoped WHERE p_status IS NULL OR status=p_status OR
      (p_status='active' AND status NOT IN ('成交','关闭')) OR
      (p_status='terminal' AND status IN ('成交','关闭'))
  ), paged AS MATERIALIZED (
    SELECT * FROM filtered ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT p_page_size+1 OFFSET (p_page-1)*p_page_size
  ), visible AS (
    SELECT id, person_id, customer_id, opportunity_type, status, discovered_at,
      last_progress, next_action, next_action_date, ai_summary, referred_name,
      referred_relation, created_at, updated_at, source_kind,
      CASE WHEN resolved_person_id IS NULL THEN NULL ELSE
        jsonb_build_object('id',resolved_person_id,'display_name',person_name) END AS person,
      resolved_customer_id
    FROM paged ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT p_page_size
  ), counts AS (
    SELECT status, count(*) AS amount FROM scoped GROUP BY status
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.updated_at DESC NULLS LAST,v.id DESC)
      FROM visible v), '[]'::jsonb),
    'page', p_page,
    'pageSize', p_page_size,
    'total', (SELECT count(*) FROM filtered),
    'hasMore', (SELECT count(*)>p_page_size FROM paged),
    'countsByStatus', COALESCE((SELECT jsonb_object_agg(status,amount) FROM counts),'{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END
$function$;
COMMIT;
