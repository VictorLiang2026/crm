BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.crm_action_context_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_uid text NOT NULL, request_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('link','wait','resume')),
  action_id bigint NOT NULL REFERENCES public.actions(id), person_id bigint NOT NULL REFERENCES public.persons(id),
  opportunity_id bigint REFERENCES public.opportunities(id), candidate_id bigint REFERENCES public.recruit_candidates(id),
  activity_id bigint REFERENCES public.activities(id), waiting_for text NOT NULL DEFAULT '',
  action_version timestamptz, person_version timestamptz,target_version timestamptz, prior_id uuid,
  preview jsonb NOT NULL, expires_at timestamptz NOT NULL DEFAULT (now()+interval '10 minutes'),
  executed_at timestamptz, UNIQUE(actor_uid,request_id),
  CHECK (num_nonnulls(opportunity_id,candidate_id,activity_id)=CASE WHEN operation='link' THEN 1 ELSE 0 END)
);
CREATE INDEX crm_action_context_history ON public.crm_action_context_commands(action_id,executed_at DESC) WHERE executed_at IS NOT NULL;
ALTER TABLE public.crm_action_context_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_action_context_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_action_context_service_only ON public.crm_action_context_commands FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.crm_action_context_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_action_context_commands TO service_role;

CREATE VIEW public.v_action_context_links WITH (security_invoker=true) AS
  SELECT a.id AS action_id,a.person_id,'opportunity'::text AS kind,a.opportunity_id AS target_id FROM public.actions a WHERE a.opportunity_id IS NOT NULL
  UNION SELECT a.id,a.person_id,'activity',a.activity_id FROM public.actions a WHERE a.activity_id IS NOT NULL
  UNION SELECT l.action_id,l.person_id,'opportunity',l.opportunity_id FROM public.crm_opportunity_action_links l
  UNION SELECT c.action_id,c.person_id,CASE WHEN c.candidate_id IS NOT NULL THEN 'candidate' WHEN c.activity_id IS NOT NULL THEN 'activity' ELSE 'opportunity' END,
    coalesce(c.candidate_id,c.activity_id,c.opportunity_id) FROM public.crm_action_context_commands c WHERE c.operation='link' AND c.executed_at IS NOT NULL;
REVOKE ALL ON public.v_action_context_links FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.v_action_context_links TO service_role;

CREATE VIEW public.v_next_context_action WITH (security_invoker=true) AS
SELECT DISTINCT ON (l.kind,l.target_id,l.person_id) l.kind,l.target_id,l.person_id,a.id,a.title,a.due_at,a.status
FROM public.v_action_context_links l JOIN public.actions a ON a.id=l.action_id AND a.person_id=l.person_id
ORDER BY l.kind,l.target_id,l.person_id,CASE WHEN a.status IN ('open','in_progress') THEN 0 ELSE 1 END,
  CASE WHEN a.status IN ('open','in_progress') THEN a.due_at END ASC NULLS LAST,a.updated_at DESC NULLS LAST,a.id;
REVOKE ALL ON public.v_next_context_action FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.v_next_context_action TO service_role;
CREATE VIEW public.v_recruit_action_directory WITH (security_invoker=true) AS
SELECT r.candidate_id,r.person_id,r.customer_id,r.customer_name,r.occupation,r.stage,r.potential_score,r.recruitment_priority,r.updated_at,r.idle_days,
  CASE WHEN a.id IS NULL THEN r.next_action WHEN a.status IN ('open','in_progress') THEN a.title END AS next_action,
  CASE WHEN a.id IS NULL THEN r.next_action_date WHEN a.status IN ('open','in_progress') THEN (a.due_at AT TIME ZONE 'Asia/Shanghai')::date END AS next_action_date,
  a.id AS action_id,a.status AS action_status
FROM (
  SELECT candidate_id,person_id,customer_id,customer_name,occupation,stage,potential_score,recruitment_priority,updated_at,idle_days,next_action,next_action_date
    FROM public.v_recruit_candidates WHERE customer_id IS NOT NULL
  UNION ALL
  SELECT candidate_id,person_id,customer_id,customer_name,occupation,stage,potential_score,recruitment_priority,updated_at,idle_days,next_action,next_action_date
    FROM public.v_recruit_candidates_person_only WHERE customer_id IS NULL
) r LEFT JOIN public.v_next_context_action a ON a.kind='candidate' AND a.target_id=r.candidate_id AND a.person_id=r.person_id;
REVOKE ALL ON public.v_recruit_action_directory FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.v_recruit_action_directory TO service_role;
CREATE FUNCTION public.crm_action_center_v1(p_actor_uid text,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $list$
DECLARE
  mode text:=p_query->>'view'; scope text:=p_query->>'kind'; target bigint:=(p_query->>'targetId')::bigint;
  action_key bigint:=(p_query->>'actionId')::bigint;
  page_no integer:=coalesce((p_query->>'page')::integer,1); term text:=btrim(coalesce(p_query->>'keyword',''));
  today date:=(now() AT TIME ZONE 'Asia/Shanghai')::date; week_start date; result jsonb; owner_person bigint;
BEGIN
  IF current_user<>'service_role' OR nullif(btrim(p_actor_uid),'') IS NULL OR jsonb_typeof(p_query) IS DISTINCT FROM 'object'
    OR p_query - ARRAY['view','kind','targetId','actionId','page','keyword'] <> '{}'::jsonb OR page_no NOT BETWEEN 1 AND 10000 OR length(term)>100
    OR mode IS NULL OR mode NOT IN ('today','week','overdue','waiting','completed','item','linked','choose')
    OR (mode IN ('linked','choose') AND (coalesce(scope,'') NOT IN ('person','opportunity','candidate','activity') OR target IS NULL OR target<=0))
    OR (mode='item' AND (action_key IS NULL OR action_key<=0)) THEN RAISE EXCEPTION 'Invalid action center query'; END IF;
  IF mode IN ('linked','choose') THEN
    IF scope='opportunity' THEN SELECT coalesce(o.person_id,c.person_id) INTO STRICT owner_person FROM public.opportunities o
      LEFT JOIN public.customers c ON c."Id"=o.customer_id AND c.deleted_at IS NULL WHERE o.id=target AND o.deleted_at IS NULL
      AND (o.customer_id IS NULL OR (c."Id" IS NOT NULL AND (o.person_id IS NULL OR c.person_id=o.person_id)));
    ELSIF scope='candidate' THEN SELECT r.person_id INTO STRICT owner_person FROM public.recruit_candidates r WHERE r.id=target AND r.deleted_at IS NULL;
    ELSIF scope='person' THEN SELECT id INTO STRICT owner_person FROM public.persons WHERE id=target AND deleted_at IS NULL;
    ELSE PERFORM 1 FROM public.activities WHERE id=target AND deleted_at IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'Activity unavailable'; END IF; END IF;
    IF scope<>'activity' AND NOT EXISTS(SELECT 1 FROM public.persons p WHERE p.id=owner_person AND p.deleted_at IS NULL) THEN RAISE EXCEPTION 'Person identity required'; END IF;
  END IF;
  week_start:=today-(extract(isodow FROM today)::integer-1);
  WITH items AS (
    SELECT a.id,a.person_id,p.display_name AS person_name,a.title,a.description,a.source,a.priority,a.status,a.updated_at,a.completed_at,a.due_at,
      (a.due_at AT TIME ZONE 'Asia/Shanghai')::date AS due_day,'action'::text AS kind,
      CASE WHEN a.status IN ('open','in_progress') AND last_cmd.operation='wait' AND NOT EXISTS(
        SELECT 1 FROM public.crm_work_item_commands wc WHERE wc.kind='action' AND wc.item_id=a.id AND wc.operation='reopen'
          AND wc.executed_at>last_cmd.executed_at) THEN last_cmd.waiting_for END AS waiting_for
    FROM public.actions a JOIN public.persons p ON p.id=a.person_id AND p.deleted_at IS NULL
    LEFT JOIN LATERAL (SELECT h.operation,h.waiting_for,h.executed_at FROM public.crm_action_context_commands h WHERE h.action_id=a.id
      AND h.operation IN ('wait','resume') AND h.executed_at IS NOT NULL ORDER BY h.executed_at DESC,h.id DESC LIMIT 1) last_cmd ON true
    WHERE (owner_person IS NULL OR a.person_id=owner_person)
      AND (term='' OR strpos(lower(concat_ws(' ',p.display_name,a.title,a.id::text)),lower(term))>0)
  ), filtered AS MATERIALIZED (
    SELECT * FROM items i WHERE CASE mode
      WHEN 'item' THEN i.id=action_key
      WHEN 'linked' THEN scope='person' OR EXISTS(SELECT 1 FROM public.v_action_context_links l WHERE l.action_id=i.id AND l.kind=scope AND l.target_id=target AND l.person_id=i.person_id)
      WHEN 'completed' THEN i.status='completed'
      ELSE i.status IN ('open','in_progress') AND CASE mode WHEN 'today' THEN i.due_day=today WHEN 'week' THEN i.due_day BETWEEN week_start AND week_start+6
        WHEN 'overdue' THEN i.due_day<today WHEN 'waiting' THEN i.waiting_for IS NOT NULL
        WHEN 'choose' THEN NOT EXISTS(SELECT 1 FROM public.v_action_context_links l WHERE l.action_id=i.id AND l.kind=scope AND l.target_id=target) END END
  ), ranked AS (
    SELECT *,row_number() OVER(ORDER BY CASE WHEN mode='completed' THEN completed_at END DESC NULLS LAST,due_at ASC NULLS LAST,id) AS n FROM filtered
  ) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(x)-'n' ORDER BY n) FROM ranked x WHERE n BETWEEN (page_no-1)*20+1 AND page_no*20),'[]'::jsonb),
    'total',count(*),'page',page_no,'hasMore',count(*)>page_no*20,'asOf',today,'personId',owner_person,'personName',(SELECT p.display_name FROM public.persons p WHERE p.id=owner_person AND p.deleted_at IS NULL)) INTO result FROM filtered;
  RETURN result;
END
$list$;
REVOKE ALL ON FUNCTION public.crm_action_center_v1(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_action_center_v1(text,jsonb) TO service_role;
CREATE FUNCTION public.crm_action_context_v1(p_actor_uid text,p_step text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $cmd$
DECLARE
  cmd public.crm_action_context_commands%ROWTYPE; a public.actions%ROWTYPE;
  act bigint; target bigint; scope text; op text; waiting text; req uuid; prior uuid; result jsonb;
  p_name text; p_version timestamptz; target_name text; t_version timestamptz; t_person bigint; already boolean;
BEGIN
  IF current_user<>'service_role' OR nullif(btrim(p_actor_uid),'') IS NULL OR length(p_actor_uid)>128 OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'Unauthorized action context'; END IF;
  IF p_step='confirm' THEN
    IF p_input-'previewId'<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid confirmation'; END IF;
    SELECT * INTO STRICT cmd FROM public.crm_action_context_commands WHERE id=(p_input->>'previewId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
    IF cmd.executed_at IS NOT NULL THEN RETURN jsonb_build_object('actionId',cmd.action_id,'replayed',true); END IF;
    IF cmd.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Action context preview expired'; END IF;
    act:=cmd.action_id;op:=cmd.operation;waiting:=cmd.waiting_for;
    target:=coalesce(cmd.opportunity_id,cmd.candidate_id,cmd.activity_id);scope:=cmd.preview->>'kind';
  ELSIF p_step='preview' THEN
    IF p_input-ARRAY['requestId','actionId','operation','kind','targetId','waitingFor']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid action context'; END IF;
    req:=(p_input->>'requestId')::uuid; act:=(p_input->>'actionId')::bigint;op:=p_input->>'operation';
    scope:=p_input->>'kind';target:=(p_input->>'targetId')::bigint;waiting:=btrim(coalesce(p_input->>'waitingFor',''));
    IF req IS NULL OR act IS NULL OR act<1 OR coalesce(op,'') NOT IN ('link','wait','resume')
      OR (op='link' AND (coalesce(scope,'') NOT IN ('opportunity','candidate','activity') OR target IS NULL OR target<1))
      OR (op<>'link' AND (scope IS NOT NULL OR target IS NOT NULL)) OR length(waiting)>200
      OR ((op='wait') IS DISTINCT FROM (length(waiting)>0)) THEN RAISE EXCEPTION 'Invalid action context'; END IF;
  ELSE RAISE EXCEPTION 'Invalid step'; END IF;
  IF p_step='confirm' THEN
    PERFORM 1 FROM public.persons WHERE id=cmd.person_id AND deleted_at IS NULL FOR SHARE;
    IF scope='opportunity' THEN PERFORM 1 FROM public.opportunities WHERE id=target FOR SHARE;
    ELSIF scope='candidate' THEN PERFORM 1 FROM public.recruit_candidates WHERE id=target FOR SHARE;
    ELSIF scope='activity' THEN PERFORM 1 FROM public.activities WHERE id=target FOR SHARE; END IF;
    PERFORM 1 FROM public.actions WHERE id=act FOR UPDATE;
  END IF;
  SELECT * INTO STRICT a FROM public.actions WHERE id=act AND status IN ('open','in_progress');
  SELECT p.display_name,p.updated_at INTO STRICT p_name,p_version FROM public.persons p WHERE p.id=a.person_id AND p.deleted_at IS NULL;
  IF EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND NOT EXISTS(
    SELECT 1 FROM public.crm_test_batches b JOIN public.crm_test_records r ON r.batch_key=b.batch_key
      WHERE b.created_by_uid=p_actor_uid AND r.record_table='actions' AND r.record_id=act::text AND EXISTS(
        SELECT 1 FROM public.crm_test_records p WHERE p.batch_key=b.batch_key AND p.record_table='persons' AND p.record_id=a.person_id::text)
        AND (op<>'link' OR EXISTS(SELECT 1 FROM public.crm_test_records t WHERE t.batch_key=b.batch_key AND t.record_id=target::text
          AND t.record_table=CASE scope WHEN 'opportunity' THEN 'opportunities' WHEN 'candidate' THEN 'recruit_candidates' ELSE 'activities' END)))
    THEN RAISE EXCEPTION 'Test account requires tracked sources'; END IF;
  IF op='link' THEN
    IF scope='opportunity' THEN
      SELECT coalesce(o.person_id,c.person_id),o.opportunity_type,o.updated_at INTO STRICT t_person,target_name,t_version FROM public.opportunities o
        LEFT JOIN public.customers c ON c."Id"=o.customer_id AND c.deleted_at IS NULL
        WHERE o.id=target AND o.deleted_at IS NULL AND (o.customer_id IS NULL OR (c."Id" IS NOT NULL AND (o.person_id IS NULL OR c.person_id=o.person_id)));
    ELSIF scope='candidate' THEN
      SELECT r.person_id,r.stage,r.updated_at INTO STRICT t_person,target_name,t_version FROM public.recruit_candidates r
        WHERE r.id=target AND r.deleted_at IS NULL;
    ELSE
      SELECT a2.name,a2.updated_at INTO STRICT target_name,t_version FROM public.activities a2 WHERE a2.id=target AND a2.deleted_at IS NULL;
    END IF;
    IF scope<>'activity' AND t_person IS DISTINCT FROM a.person_id THEN RAISE EXCEPTION 'Action Person mismatch'; END IF;
    SELECT EXISTS(SELECT 1 FROM public.v_action_context_links l WHERE l.action_id=act AND l.kind=scope AND l.target_id=target) INTO already;
    IF already THEN RAISE EXCEPTION 'Action already linked'; END IF;
  ELSE
    SELECT h.id INTO prior FROM public.crm_action_context_commands h WHERE h.action_id=act AND h.executed_at IS NOT NULL AND h.operation IN ('wait','resume')
      ORDER BY h.executed_at DESC,h.id DESC LIMIT 1;
    IF op='resume' AND public.crm_action_center_v1(p_actor_uid,jsonb_build_object('view','item','actionId',act))#>>'{rows,0,waiting_for}' IS NULL
      THEN RAISE EXCEPTION 'Action is not waiting'; END IF;
  END IF;
  IF p_step='preview' THEN
    INSERT INTO public.crm_action_context_commands(actor_uid,request_id,operation,action_id,person_id,opportunity_id,candidate_id,activity_id,
      waiting_for,person_version,action_version,target_version,prior_id,preview)
    VALUES(p_actor_uid,req,op,act,a.person_id,CASE WHEN scope='opportunity' THEN target END,CASE WHEN scope='candidate' THEN target END,
      CASE WHEN scope='activity' THEN target END,waiting,p_version,a.updated_at,t_version,prior,jsonb_build_object('operation',op,'actionId',act,'personId',a.person_id,
        'personName',p_name,'title',a.title,'dueAt',a.due_at,'status',a.status,'kind',scope,'targetId',target,'targetName',target_name,'waitingFor',waiting))
    ON CONFLICT(actor_uid,request_id) DO NOTHING RETURNING * INTO cmd;
    IF NOT FOUND THEN SELECT * INTO STRICT cmd FROM public.crm_action_context_commands WHERE actor_uid=p_actor_uid AND request_id=req;
      IF cmd.action_id<>act OR cmd.operation<>op OR cmd.waiting_for<>waiting OR cmd.preview->>'kind' IS DISTINCT FROM scope OR
        coalesce(cmd.opportunity_id,cmd.candidate_id,cmd.activity_id) IS DISTINCT FROM target THEN RAISE EXCEPTION 'Request ID reused'; END IF;
    END IF;
    RETURN jsonb_build_object('previewId',cmd.id,'preview',cmd.preview,'expiresAt',cmd.expires_at);
  END IF;
  IF cmd.action_version IS DISTINCT FROM a.updated_at OR cmd.person_version IS DISTINCT FROM p_version OR cmd.target_version IS DISTINCT FROM t_version
    OR cmd.prior_id IS DISTINCT FROM prior THEN RAISE EXCEPTION 'Action context changed'; END IF;
  UPDATE public.crm_action_context_commands SET executed_at=clock_timestamp() WHERE id=cmd.id;
  RETURN jsonb_build_object('actionId',act,'replayed',false);
END
$cmd$;
REVOKE ALL ON FUNCTION public.crm_action_context_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_action_context_v1(text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
