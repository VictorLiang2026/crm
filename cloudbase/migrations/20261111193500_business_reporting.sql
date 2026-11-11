BEGIN;
SET LOCAL lock_timeout='5s';
DO $check$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.crm_opportunity_directory_v1(text,integer,integer,text,text,text,bigint,text)'::regprocedure) IS DISTINCT FROM '783a73237f38cc907687fa9cfb3f8785'
    THEN RAISE EXCEPTION 'Pipeline directory changed'; END IF;
END $check$;
CREATE VIEW public.v_business_pipeline_records WITH(security_invoker=true) AS
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
    )
      SELECT b.*,p.display_name AS person_name,coalesce(b.confirmed_stage,b.mapped_stage,b.raw_stage) AS stage,
        CASE WHEN b.confirmed_stage IS NULL THEN b.terminal ELSE b.confirmed_stage IN ('已成交','暂缓','未达成','已加入','继续培养','暂不推进') END AS is_closed
      FROM judged b JOIN public.persons p ON p.id=b.person_id AND p.deleted_at IS NULL;
REVOKE ALL ON public.v_business_pipeline_records FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.v_business_pipeline_records TO service_role;
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
    WITH scoped AS (
      SELECT b.* FROM public.v_business_pipeline_records b
      WHERE (p_kind NOT IN ('protection','recruitment') OR b.track=p_kind)
        AND (p_kind<>'due' OR b.next_date <= (now() AT TIME ZONE 'Asia/Shanghai')::date)
        AND (p_person_id IS NULL OR b.person_id=p_person_id)
        AND (p_type IS NULL OR b.record_type=p_type OR
          (p_type='source_referral' AND (b.declared_source='referral' OR b.record_type IN ('referral','转介绍'))))
        AND (p_query IS NULL OR strpos(lower(concat_ws(' ',b.person_name,b.raw_stage,b.record_type,b.next_action)),lower(btrim(p_query)))>0)
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

CREATE VIEW public.v_business_followup_queue WITH(security_invoker=true) AS
WITH event_contacts AS (
  SELECT ap.activity_id,ap.canonical_person_id AS person_id,
    CASE WHEN ap.canonical_person_id IS NULL THEN ap.id END AS unresolved_id,
    ap.person_name AS staged_name,NULL::bigint AS action_id
  FROM public.activity_participants ap
  WHERE ap.deleted_at IS NULL AND ap.followup_status='pending'
  UNION ALL
  SELECT l.target_id,l.person_id,NULL,NULL,l.action_id FROM public.v_action_context_links l
  JOIN public.actions a ON a.id=l.action_id AND a.person_id=l.person_id AND a.status IN ('open','in_progress')
  WHERE l.kind='activity'
), event_rows AS (
  SELECT ev.id,ec.person_id,ec.unresolved_id,coalesce(p.display_name,max(ec.staged_name)) AS person_name,
    ev.name,ev.activity_date,min(ec.action_id) AS action_id
  FROM event_contacts ec JOIN public.activities ev ON ev.id=ec.activity_id AND ev.deleted_at IS NULL
  LEFT JOIN public.persons p ON p.id=ec.person_id AND p.deleted_at IS NULL
  WHERE ev.status IN ('ended','reviewed') AND (ec.person_id IS NULL OR p.id IS NOT NULL)
  GROUP BY ev.id,ec.person_id,ec.unresolved_id,p.display_name,ev.name,ev.activity_date
)
SELECT b.track AS queue,b.id,b.person_id,b.person_name,b.stage AS description,b.next_date AS day,b.action_id,
  b.record_type,NULL::bigint AS unresolved_id FROM public.v_business_pipeline_records b
WHERE b.track IN ('protection','recruitment') AND NOT b.is_closed AND b.next_date <= (now() AT TIME ZONE 'Asia/Shanghai')::date
  AND (b.customer_id IS NULL OR EXISTS(SELECT 1 FROM public.customers c WHERE c."Id"=b.customer_id AND c.person_id=b.person_id AND c.deleted_at IS NULL))
UNION ALL SELECT 'event',id,person_id,person_name,name,activity_date,action_id,NULL,unresolved_id FROM event_rows;
REVOKE ALL ON public.v_business_followup_queue FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.v_business_followup_queue TO service_role;

CREATE FUNCTION public.crm_business_report_v1(p_actor_uid text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $report$
DECLARE
  mode text:=p_input->>'mode'; queue_name text:=p_input->>'queue';
  days integer:=coalesce((p_input->>'days')::integer,30); page_no integer:=coalesce((p_input->>'page')::integer,1);
  today date:=(now() AT TIME ZONE 'Asia/Shanghai')::date; start_day date; start_at timestamptz; end_at timestamptz;
  key text; counts jsonb; result jsonb;
BEGIN
  IF current_user<>'service_role' OR coalesce(length(btrim(p_actor_uid)),0) NOT BETWEEN 1 AND 128
    OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR coalesce(mode,'') NOT IN ('home','list','report')
    OR days NOT IN (7,30,90) OR page_no NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Invalid business report'; END IF;
  IF mode='list' THEN
    IF coalesce(queue_name,'') NOT IN ('protection','recruitment','event') THEN RAISE EXCEPTION 'Invalid follow-up list'; END IF;
    WITH matching AS MATERIALIZED (SELECT * FROM public.v_business_followup_queue q WHERE q.queue=queue_name),
    visible AS (SELECT * FROM matching ORDER BY day,id,person_id NULLS LAST,unresolved_id LIMIT 20 OFFSET (page_no-1)*20)
    SELECT jsonb_build_object('asOf',today,'page',page_no,'total',count(*),'hasMore',count(*)>page_no*20,
      'rows',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY day,id,person_id NULLS LAST,unresolved_id) FROM visible v),'[]'::jsonb))
      INTO result FROM matching;
    RETURN result;
  END IF;
  SELECT jsonb_build_object('protection',count(*) FILTER(WHERE queue='protection'),'recruitment',count(*) FILTER(WHERE queue='recruitment'),
    'event',count(*) FILTER(WHERE queue='event')) INTO counts FROM public.v_business_followup_queue;
  FOREACH key IN ARRAY ARRAY['today','overdue','waiting'] LOOP
    counts:=counts||jsonb_build_object(key,public.crm_action_center_v1(p_actor_uid,jsonb_build_object('view',key))->'total');
  END LOOP;
  FOREACH key IN ARRAY ARRAY['review','renewal','verify'] LOOP
    counts:=counts||jsonb_build_object(key,public.person_customer_worklist_v1(jsonb_build_object('page',1,'pageSize',1,'keyword','','sortField','id',
      'sortDir','asc','status','all','customerPriorities','[]'::jsonb,'policyFilter',key))->'total');
  END LOOP;
  IF mode='home' THEN RETURN jsonb_build_object('asOf',today,'counts',counts); END IF;
  start_day:=today-days+1; start_at:=start_day::timestamp AT TIME ZONE 'Asia/Shanghai'; end_at:=(today+1)::timestamp AT TIME ZONE 'Asia/Shanghai';
  WITH live_people AS MATERIALIZED (SELECT id FROM public.persons WHERE deleted_at IS NULL),
  clients AS MATERIALIZED (SELECT c."Id" AS id,c.person_id FROM public.customers c JOIN live_people p ON p.id=c.person_id WHERE c.deleted_at IS NULL),
  pipeline AS MATERIALIZED (
    SELECT b.* FROM public.v_business_pipeline_records b WHERE b.track IN ('protection','recruitment') AND
      (b.customer_id IS NULL OR EXISTS(SELECT 1 FROM clients c WHERE c.id=b.customer_id AND c.person_id=b.person_id))
  ), moves AS MATERIALIZED (
    SELECT b.track,b.id AS record_id,d.id,d.prior_id,d.confirmed_at,d.stage,d.reason,d.preview->>'before' AS before_stage
    FROM public.crm_pipeline_decisions d JOIN pipeline b ON b.person_id=d.person_id AND
      ((b.track='protection' AND d.protection_id=b.id) OR (b.track='recruitment' AND d.recruit_id=b.id))
    WHERE d.confirmed_at IS NOT NULL AND d.confirmed_at<end_at
  ), period_moves AS (
    SELECT * FROM moves WHERE confirmed_at>=start_at AND before_stage IS NOT NULL AND before_stage<>stage
  ), cohorts AS (
    SELECT track,record_id,min(confirmed_at) AS entered FROM moves
    WHERE stage=CASE track WHEN 'protection' THEN '需求线索' ELSE '关系建立' END AND before_stage IS NOT NULL AND before_stage<>stage
    GROUP BY track,record_id HAVING min(confirmed_at)>=start_at
  ), measured_dwell AS (
    SELECT m.track,(extract(epoch FROM m.confirmed_at-p.confirmed_at)/86400)::numeric AS days_in_stage
    FROM period_moves m JOIN moves p ON p.id=m.prior_id AND p.track=m.track AND p.record_id=m.record_id
      AND p.stage=m.before_stage AND p.before_stage IS NOT NULL AND p.before_stage<>p.stage AND m.confirmed_at>=p.confirmed_at
  ), tracks AS (
    SELECT k AS track,jsonb_build_object(
      'total',(SELECT count(*) FROM pipeline WHERE track=k),
      'active',(SELECT count(*) FROM pipeline WHERE track=k AND NOT is_closed),
      'stages',coalesce((SELECT jsonb_agg(jsonb_build_object('stage',stage,'n',n) ORDER BY stage) FROM
        (SELECT stage,count(*) n FROM pipeline WHERE track=k GROUP BY stage) s),'[]'::jsonb),
      'referral',(SELECT count(*) FROM pipeline WHERE track=k AND declared_source='referral'),
      'unknownSource',(SELECT count(*) FROM pipeline WHERE track=k AND nullif(declared_source,'') IS NULL),
      'moves',(SELECT count(*) FROM period_moves WHERE track=k),
      'movedRecords',(SELECT count(DISTINCT record_id) FROM period_moves WHERE track=k),
      'dueDated',(SELECT count(*) FROM pipeline WHERE track=k AND NOT is_closed AND next_date IS NOT NULL),
      'overdue',(SELECT count(*) FROM pipeline WHERE track=k AND NOT is_closed AND next_date<today),
      'cohort',(SELECT count(*) FROM cohorts WHERE track=k),
      'unverifiedCohort',(SELECT count(*) FROM cohorts c JOIN pipeline b ON b.track=c.track AND b.id=c.record_id
        WHERE c.track=k AND (b.stage IS DISTINCT FROM (SELECT m.stage FROM moves m WHERE m.track=k AND m.record_id=c.record_id ORDER BY m.confirmed_at DESC,m.id DESC LIMIT 1)
        OR EXISTS(SELECT 1 FROM moves m LEFT JOIN moves prev ON prev.id=m.prior_id AND prev.track=m.track AND prev.record_id=m.record_id
          WHERE m.track=k AND m.record_id=c.record_id AND m.confirmed_at>c.entered AND m.before_stage IS DISTINCT FROM prev.stage))),
      'converted',(SELECT count(*) FROM cohorts c WHERE track=k AND EXISTS(SELECT 1 FROM period_moves m WHERE m.track=k AND m.record_id=c.record_id
        AND m.confirmed_at>c.entered AND m.stage=CASE k WHEN 'protection' THEN '已成交' ELSE '已加入' END)),
      'dwellN',(SELECT count(*) FROM measured_dwell WHERE track=k),
      'dwellDays',(SELECT round((percentile_cont(0.5) WITHIN GROUP(ORDER BY days_in_stage))::numeric,1) FROM measured_dwell WHERE track=k),
      'outcomes',coalesce((SELECT jsonb_agg(jsonb_build_object('stage',stage,'n',n) ORDER BY stage) FROM
        (SELECT stage,count(*) n FROM period_moves WHERE track=k AND stage IN ('已成交','暂缓','未达成','已加入','继续培养','暂不推进') GROUP BY stage) s),'[]'::jsonb),
      'recentReasons',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.at DESC,s.id DESC) FROM
        (SELECT id,stage,reason,confirmed_at AS at FROM period_moves WHERE track=k AND stage IN ('已成交','暂缓','未达成','已加入','继续培养','暂不推进')
         AND nullif(btrim(reason),'') IS NOT NULL ORDER BY confirmed_at DESC,id DESC LIMIT 5) s),'[]'::jsonb)
    ) AS stats FROM unnest(ARRAY['protection','recruitment']) k
  ), attendance AS MATERIALIZED (
    SELECT ap.*,e.activity_date FROM public.activity_participants ap JOIN public.activities e ON e.id=ap.activity_id AND e.deleted_at IS NULL
    WHERE ap.deleted_at IS NULL AND (ap.canonical_person_id IS NULL OR EXISTS(SELECT 1 FROM live_people p WHERE p.id=ap.canonical_person_id))
  ), roles AS (
    SELECT DISTINCT r.person_id,r.role FROM public.person_roles r JOIN live_people p ON p.id=r.person_id
    WHERE r.role IN ('customer','recruit','referrer','speaker')
    UNION SELECT canonical_person_id,'participant' FROM attendance WHERE canonical_person_id IS NOT NULL
  ), work AS MATERIALIZED (
    SELECT a.* FROM public.actions a JOIN live_people p ON p.id=a.person_id
  ), linked AS MATERIALIZED (
    SELECT DISTINCT l.action_id,l.kind FROM public.v_action_context_links l JOIN work a ON l.action_id=a.id AND l.person_id=a.person_id WHERE
      (l.kind='activity' AND EXISTS(SELECT 1 FROM public.activities e WHERE e.id=l.target_id AND e.deleted_at IS NULL))
      OR EXISTS(SELECT 1 FROM pipeline b WHERE b.id=l.target_id AND b.entity=l.kind AND b.person_id=l.person_id)
      OR (l.kind='opportunity' AND EXISTS(SELECT 1 FROM public.opportunities o WHERE o.id=l.target_id AND o.deleted_at IS NULL AND
        (o.customer_id IS NULL OR EXISTS(SELECT 1 FROM clients c WHERE c.id=o.customer_id AND c.person_id=l.person_id)) AND (o.person_id IS NULL OR o.person_id=l.person_id)))
    UNION SELECT id,'policy' FROM public.v_policy_service_actions
    UNION SELECT a.id,'interaction' FROM work a JOIN public.interactions i ON i.id=a.interaction_id AND i.person_id=a.person_id AND i.deleted_at IS NULL
  ), period_work AS (SELECT * FROM work WHERE due_at>=start_at AND due_at<end_at AND status<>'cancelled'),
  marks AS (SELECT m.to_stage,count(*) n FROM public.recruit_milestones m JOIN pipeline b ON b.track='recruitment' AND b.id=m.candidate_id
    WHERE m.happened_at>=start_at AND m.happened_at<end_at AND m.to_stage IN ('新增人才','互动暖客','初次面谈','增员活动','精准面谈','入职申请','签约入司') GROUP BY m.to_stage),
  event_period AS (SELECT a.status,r.response FROM attendance a LEFT JOIN public.activity_participant_responses r ON r.participant_id=a.id
    WHERE a.activity_date BETWEEN start_day AND today),
  review_accepts AS (SELECT cmd.operation FROM public.crm_activity_review_commands cmd JOIN live_people p ON p.id=cmd.person_id
    JOIN public.activities e ON e.id=cmd.activity_id AND e.deleted_at IS NULL WHERE cmd.executed_at>=start_at AND cmd.executed_at<end_at
    AND cmd.operation IN ('action','opportunity') AND cmd.result_json->>'status'='accepted'),
  product_data AS MATERIALIZED (
    SELECT p.customer_id,p.current_policy_description,
      CASE WHEN pg_catalog.pg_input_is_valid(p.items,'jsonb') THEN p.items::jsonb END AS items
    FROM public.products p JOIN clients c ON c.id=p.customer_id WHERE p.deleted_at IS NULL
  ), item_fields AS (
    SELECT f.filled FROM product_data p CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.items)='array' THEN p.items ELSE '[]'::jsonb END) i
    CROSS JOIN LATERAL (SELECT count(*) AS filled FROM unnest(ARRAY['coverage_amount','total_premium','paid_premium','annual_premium','update_date']) k
      WHERE nullif(btrim(i->>k),'') IS NOT NULL) f WHERE f.filled>0
  ), report_state AS MATERIALIZED (SELECT * FROM public.v_policy_review_state)
  SELECT jsonb_build_object('asOf',today,'startDay',start_day,'days',days,'counts',counts,
    'pipeline',(SELECT jsonb_object_agg(track,stats) FROM tracks),
    'milestones',coalesce((SELECT jsonb_object_agg(to_stage,n) FROM marks),'{}'::jsonb),
    'roles',jsonb_build_object('total',(SELECT count(*) FROM live_people),'multi',(SELECT count(*) FROM (SELECT person_id FROM roles GROUP BY person_id HAVING count(*)>1) m),
      'coverage',(SELECT coalesce(jsonb_object_agg(role,n),'{}'::jsonb) FROM (SELECT role,count(*) AS n FROM roles GROUP BY role) rc)),
    'events',jsonb_build_object('heldDates',(SELECT count(*) FROM public.activities WHERE deleted_at IS NULL AND activity_date BETWEEN start_day AND today),
      'entries',(SELECT count(*) FROM event_period),'registered',(SELECT count(*) FROM event_period WHERE response='registered'),
      'cancelled',(SELECT count(*) FROM event_period WHERE response='cancelled'),'attended',(SELECT count(*) FROM event_period WHERE status='attended'),
      'interactions',(SELECT count(*) FROM public.interactions i JOIN live_people p ON p.id=i.person_id JOIN public.activities e ON e.id=i.activity_id AND e.deleted_at IS NULL
        WHERE i.deleted_at IS NULL AND i.interaction_type='post_event_followup' AND i.interaction_at>=start_at AND i.interaction_at<end_at),
      'completed',(SELECT count(*) FROM work a WHERE a.completed_at>=start_at AND a.completed_at<end_at AND a.status='completed' AND EXISTS(SELECT 1 FROM linked l WHERE l.action_id=a.id AND l.kind='activity')),
      'acceptedCandidates',(SELECT count(*) FROM review_accepts WHERE operation='opportunity'),'acceptedActions',(SELECT count(*) FROM review_accepts WHERE operation='action')),
    'actions',jsonb_build_object('open',(SELECT count(*) FROM work WHERE status IN ('open','in_progress')),'dated',(SELECT count(*) FROM work WHERE status IN ('open','in_progress') AND due_at IS NOT NULL),
      'due',(SELECT count(*) FROM period_work),'completed',(SELECT count(*) FROM period_work WHERE status='completed'),
      'unlinked',(SELECT count(*) FROM work a WHERE status IN ('open','in_progress') AND NOT EXISTS(SELECT 1 FROM linked l WHERE l.action_id=a.id)),
      'workload',(SELECT coalesce(jsonb_object_agg(kind,n),'{}'::jsonb) FROM (SELECT l.kind,count(*) n FROM linked l JOIN period_work a ON l.action_id=a.id GROUP BY l.kind) w)),
    'policy',jsonb_build_object('customers',(SELECT count(*) FROM clients),'withProduct',(SELECT count(*) FROM product_data),'described',(SELECT count(*) FROM product_data WHERE nullif(btrim(current_policy_description),'') IS NOT NULL),
      'startedItems',(SELECT count(*) FROM item_fields),'completeItems',(SELECT count(*) FROM item_fields WHERE filled=5),
      'withCurrent',(SELECT count(DISTINCT customer_id) FROM report_state WHERE is_current),'valid',(SELECT count(*) FROM report_state WHERE is_valid),'current',(SELECT count(*) FROM report_state WHERE is_current)))
    INTO result;
  RETURN result;
END
$report$;
REVOKE ALL ON FUNCTION public.crm_business_report_v1(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_business_report_v1(text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
