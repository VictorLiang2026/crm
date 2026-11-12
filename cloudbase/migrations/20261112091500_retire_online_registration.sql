BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
-- The write path has switched to the roster. Never silently discard a new public submission.
LOCK TABLE public.activity_registration_pages,public.activity_registration_submissions,
 public.activity_registration_people,public.activity_registration_audit,public.activity_participants,
 public.activity_participant_responses IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.activity_registration_submissions) OR EXISTS(SELECT FROM public.activity_registration_people)
 THEN RAISE EXCEPTION 'Registration data changed since dependency review'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.crm_business_report_v1(p_actor_uid text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    WHERE ap.roster_id IS NOT NULL AND ap.deleted_at IS NULL AND (ap.canonical_person_id IS NULL OR EXISTS(SELECT 1 FROM live_people p WHERE p.id=ap.canonical_person_id))
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
  event_period AS (SELECT a.status FROM attendance a
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
      'missingLists',(SELECT count(*) FROM public.activities e WHERE e.deleted_at IS NULL AND e.activity_date BETWEEN start_day AND today AND NOT EXISTS(SELECT FROM public.activity_roster_commands c WHERE c.activity_id=e.id AND c.operation='import' AND c.completed_at IS NOT NULL)),
      'entries',(SELECT count(*) FROM event_period),
      'attended',(SELECT count(*) FROM event_period WHERE status='attended'),
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
$function$;

CREATE OR REPLACE FUNCTION public.crm_person_role_sync_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ids bigint[] := '{}';
  v_id bigint;
BEGIN
  IF TG_TABLE_NAME = 'customers' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || NEW.person_id;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || OLD.person_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'persons' THEN
    v_ids := v_ids || NEW.id;
  ELSIF TG_TABLE_NAME = 'activity_participants' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_ids := v_ids || NEW.canonical_person_id;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_ids := v_ids || OLD.canonical_person_id;
    END IF;
    -- Independent activity roster entries have no Person role to recompute.
    IF NOT EXISTS (SELECT FROM pg_catalog.unnest(v_ids) AS p(id) WHERE p.id IS NOT NULL) THEN
      RETURN NULL;
    END IF;
  ELSE
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
END
$function$;
DROP FUNCTION public.crm_event_participation_v1(text,text,jsonb) RESTRICT;
DROP TABLE public.activity_participant_responses RESTRICT;
DELETE FROM public.activity_participants WHERE roster_id IS NULL;
UPDATE public.activities a SET actual_participants=NULL WHERE a.actual_participants IS NOT NULL
 AND NOT EXISTS(SELECT FROM public.activity_roster_commands c WHERE c.activity_id=a.id AND c.operation='import' AND c.completed_at IS NOT NULL);
-- Only the protected Person service may add new participation; no anonymous writes or roster reads.
REVOKE INSERT,UPDATE,DELETE ON public.activity_participants FROM anon;

DROP FUNCTION public.crm_registration_public_v1(text,text),public.crm_registration_staff_v1(text,text) RESTRICT;
DROP FUNCTION public.crm_registration_handle_v1(text,text,text) RESTRICT;
DROP FUNCTION public.crm_registration_public_data_v1(text,jsonb),public.crm_registration_staff_data_v1(text,jsonb,text) RESTRICT;
DROP FUNCTION public.crm_activity_registration_write_v1(text,jsonb) RESTRICT;
DROP TABLE public.activity_registration_receipts,public.activity_registration_nonces,public.activity_registration_signers RESTRICT;
DROP TABLE public.activity_registration_audit,public.activity_registration_people RESTRICT;
DROP TABLE public.activity_registration_submissions RESTRICT;
DROP TABLE public.activity_registration_pages RESTRICT;
DO $$ BEGIN
 IF (SELECT obj_description(e.oid,'pg_extension') FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto' AND n.nspname='public') IS DISTINCT FROM 'Installed by CRM migration 20261111234500 for activity registration'
 THEN RAISE EXCEPTION 'Unexpected extension ownership'; END IF;
END $$;
DROP EXTENSION pgcrypto RESTRICT;
COMMIT;
