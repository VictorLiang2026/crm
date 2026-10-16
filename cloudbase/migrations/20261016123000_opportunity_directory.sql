BEGIN;

CREATE FUNCTION public.crm_opportunity_directory_v1(
  p_actor_uid text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_kind text DEFAULT 'all',
  p_status text DEFAULT NULL,
  p_type text DEFAULT NULL,
  p_person_id bigint DEFAULT NULL,
  p_query text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
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
      AND (NOT EXISTS (
        SELECT 1 FROM public.crm_test_batches b WHERE b.created_by_uid=p_actor_uid
      ) OR EXISTS (
        SELECT 1 FROM public.crm_test_records r
        JOIN public.crm_test_batches b ON b.batch_key=r.batch_key
        WHERE b.created_by_uid=p_actor_uid AND r.record_table='opportunities'
          AND r.record_id=o.id::text
      ))
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

REVOKE ALL ON FUNCTION public.crm_opportunity_directory_v1(text,integer,integer,text,text,text,bigint,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_opportunity_directory_v1(text,integer,integer,text,text,text,bigint,text)
  TO service_role;

COMMIT;
