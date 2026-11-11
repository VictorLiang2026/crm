BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.person_customer_worklist_v1(jsonb)'::regprocedure) IS DISTINCT FROM 'cbf1f393918d443bda837446ac6b7469' THEN RAISE EXCEPTION 'Customer worklist changed'; END IF;
END $guard$;
ALTER TABLE public.policy_review_reports
  ADD COLUMN review_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN review_valid boolean NOT NULL DEFAULT true,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_basis text;
CREATE FUNCTION public.crm_policy_report_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $trigger$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.review_revision<>0 OR NOT NEW.review_valid OR NEW.reviewed_at IS NOT NULL OR NEW.review_basis IS NOT NULL THEN
      RAISE EXCEPTION 'New reports require review'; END IF;
    RETURN NEW;
  END IF;
  IF current_user<>'service_role' AND ROW(NEW.review_valid,NEW.reviewed_at,NEW.review_basis,NEW.review_revision)
      IS DISTINCT FROM ROW(OLD.review_valid,OLD.reviewed_at,OLD.review_basis,OLD.review_revision) THEN
    RAISE EXCEPTION 'Review decision requires service role'; END IF;
  IF (to_jsonb(NEW)-ARRAY['review_revision','review_valid','reviewed_at','review_basis','updated_at','deleted_at','delete_batch_id'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['review_revision','review_valid','reviewed_at','review_basis','updated_at','deleted_at','delete_batch_id']) THEN
    NEW.reviewed_at:=NULL; NEW.review_basis:=NULL;
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN NEW.review_revision:=OLD.review_revision+1; END IF;
  RETURN NEW;
END
$trigger$;
REVOKE ALL ON FUNCTION public.crm_policy_report_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_policy_report_guard() TO service_role;
CREATE TRIGGER crm_policy_report_review_guard BEFORE INSERT OR UPDATE ON public.policy_review_reports
  FOR EACH ROW EXECUTE FUNCTION public.crm_policy_report_guard();

CREATE TABLE public.policy_service_action_scopes (
  preview_id uuid PRIMARY KEY REFERENCES public.crm_work_item_commands(id) ON DELETE CASCADE,
  customer_id bigint NOT NULL REFERENCES public.customers("Id") ON DELETE CASCADE,
  service_kind text NOT NULL CHECK(service_kind IN ('review','renewal'))
);
CREATE INDEX policy_service_action_customer ON public.policy_service_action_scopes(customer_id,service_kind);
CREATE TABLE public.policy_opportunity_report_links (
  opportunity_id bigint NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  report_id bigint NOT NULL REFERENCES public.policy_review_reports(id) ON DELETE CASCADE,
  PRIMARY KEY(opportunity_id,report_id)
);
ALTER TABLE public.policy_service_action_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_service_action_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_service_action_scopes_service ON public.policy_service_action_scopes FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.policy_service_action_scopes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.policy_service_action_scopes TO service_role;
ALTER TABLE public.policy_opportunity_report_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_opportunity_report_links FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_opportunity_report_links_service ON public.policy_opportunity_report_links FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.policy_opportunity_report_links FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.policy_opportunity_report_links TO service_role;
CREATE VIEW public.v_policy_review_state WITH(security_invoker=true) AS
SELECT r.id,r.customer_id,c.person_id,r.report_date,r.report_type,r.review_revision,r.review_valid AS is_valid,
  r.reviewed_at,r.review_basis,r.input_products_version,r.edited_summary,r.summary,r.edited_gaps,r.gaps_found,
  r.edited_recommendations,r.next_action,r.edited_next_action,r.updated_at,r.deleted_at,
  (p.id::text||':'||p.version::text) AS product_basis,
  (r.review_valid AND r.reviewed_at IS NOT NULL AND coalesce(r.review_basis=p.id::text||':'||p.version::text,false)) AS is_current
FROM public.policy_review_reports r JOIN public.customers c ON c."Id"=r.customer_id AND c.deleted_at IS NULL
JOIN public.persons pe ON pe.id=c.person_id AND pe.deleted_at IS NULL
LEFT JOIN public.products p ON p.customer_id=c."Id" AND p.deleted_at IS NULL
WHERE r.deleted_at IS NULL;
CREATE VIEW public.v_policy_service_actions WITH(security_invoker=true) AS
SELECT s.customer_id,w.person_id,s.service_kind,a.id,a.title,a.due_at,a.status
FROM public.policy_service_action_scopes s JOIN public.crm_work_item_commands w ON w.id=s.preview_id AND w.status='executed'
JOIN public.actions a ON a.id=(w.result->>'itemId')::bigint AND a.person_id=w.person_id
JOIN public.customers c ON c."Id"=s.customer_id AND c.person_id=w.person_id AND c.deleted_at IS NULL
JOIN public.persons p ON p.id=w.person_id AND p.deleted_at IS NULL;
REVOKE ALL ON public.v_policy_review_state,public.v_policy_service_actions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.v_policy_review_state,public.v_policy_service_actions TO service_role;
CREATE FUNCTION public.crm_policy_service_v1(p_actor_uid text,p_op text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $service$
DECLARE
  cid bigint:=(p_input->>'customerId')::bigint; oid_key bigint:=(p_input->>'opportunityId')::bigint;
  rid bigint:=(p_input->>'reportId')::bigint; pid bigint; receipt uuid; result jsonb; rec public.v_policy_review_state%ROWTYPE;
  service_type text:=p_input->>'kind'; day_text text:=p_input->>'day'; op_person bigint; op_customer bigint; protection text;
BEGIN
  IF current_user<>'service_role' OR coalesce(length(btrim(p_actor_uid)),0) NOT BETWEEN 1 AND 128 OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid policy request'; END IF;
  IF p_op IN ('options','link') THEN
    SELECT o.person_id,o.customer_id,o.opportunity_type INTO STRICT op_person,op_customer,protection FROM public.opportunities o WHERE o.id=oid_key AND o.deleted_at IS NULL FOR SHARE;
    IF protection NOT IN ('insurance','医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障') THEN RAISE EXCEPTION 'Invalid policy opportunity'; END IF;
    SELECT c."Id" INTO cid FROM public.customers c WHERE c.deleted_at IS NULL AND
      (op_customer IS NULL OR c."Id"=op_customer) AND (op_person IS NULL OR c.person_id=op_person)
      AND coalesce(op_customer,op_person) IS NOT NULL;
    IF cid IS NULL AND p_op='options' THEN RETURN jsonb_build_object('rows','[]'::jsonb); END IF;
  END IF;
  IF p_op='confirmSchedule' THEN
    SELECT customer_id INTO STRICT cid FROM public.policy_service_action_scopes WHERE preview_id=(p_input->>'previewId')::uuid;
  END IF;
  SELECT c.person_id INTO STRICT pid FROM public.customers c JOIN public.persons p ON p.id=c.person_id AND p.deleted_at IS NULL
    WHERE c."Id"=cid AND c.deleted_at IS NULL FOR SHARE OF c,p;
  IF p_op='options' THEN
    SELECT jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('id',v.id,'date',v.report_date,'revision',v.review_revision,'basis',v.product_basis,
      'summary',CASE WHEN v.is_current THEN coalesce(nullif(v.edited_summary,''),v.summary) END,'current',v.is_current,'linked',l.report_id IS NOT NULL)
      ORDER BY v.report_date DESC NULLS LAST,v.id DESC),'[]'::jsonb)) INTO result
    FROM public.v_policy_review_state v LEFT JOIN public.policy_opportunity_report_links l ON l.report_id=v.id AND l.opportunity_id=oid_key
    WHERE v.customer_id=cid AND (v.is_current OR l.report_id IS NOT NULL);
    RETURN result;
  ELSIF p_op='scheduleList' THEN
    RETURN jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.due_at,a.id) FROM public.v_policy_service_actions a
      WHERE a.customer_id=cid AND a.status IN ('open','in_progress')),'[]'::jsonb));
  ELSIF p_op='state' THEN
    SELECT * INTO STRICT rec FROM public.v_policy_review_state WHERE customer_id=cid AND id=rid;
    RETURN to_jsonb(rec)-ARRAY['summary','edited_summary','gaps_found','edited_gaps','edited_recommendations','next_action','edited_next_action'];
  END IF;
  IF EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND NOT EXISTS (
    SELECT 1 FROM public.crm_test_batches b JOIN public.crm_test_records r ON r.batch_key=b.batch_key AND r.record_table='persons' AND r.record_id=pid::text
    WHERE b.created_by_uid=p_actor_uid AND (rid IS NULL OR EXISTS(SELECT 1 FROM public.crm_test_records x WHERE x.batch_key=b.batch_key AND x.record_table='policy_review_reports' AND x.record_id=rid::text))
      AND (oid_key IS NULL OR EXISTS(SELECT 1 FROM public.crm_test_records x WHERE x.batch_key=b.batch_key AND x.record_table='opportunities' AND x.record_id=oid_key::text))
  ) THEN RAISE EXCEPTION 'Test account requires tracked policy records'; END IF;
  IF p_op='schedule' THEN
    IF coalesce(service_type,'') NOT IN ('review','renewal') OR coalesce(day_text,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid policy service date'; END IF;
    PERFORM day_text::date;
    result:=public.crm_work_item_preview_v1(p_actor_uid,(p_input->>'requestId')::uuid,'action','create',pid,NULL,
      jsonb_build_object('title',p_input->>'title','priority','medium','description',NULL,'dueAt',day_text||'T12:00:00+08:00'));
    receipt:=(result->>'previewId')::uuid;
    INSERT INTO public.policy_service_action_scopes VALUES(receipt,cid,service_type) ON CONFLICT DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM public.policy_service_action_scopes WHERE preview_id=receipt AND customer_id=cid AND service_kind=service_type) THEN RAISE EXCEPTION 'Policy preview mismatch'; END IF;
    RETURN result||jsonb_build_object('kind',service_type,'day',day_text);
  ELSIF p_op='confirmSchedule' THEN
    receipt:=(p_input->>'previewId')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.crm_work_item_commands w WHERE w.id=receipt AND w.person_id=pid AND w.actor_uid=p_actor_uid) THEN RAISE EXCEPTION 'Policy preview mismatch'; END IF;
    RETURN public.crm_work_item_execute_v1(p_actor_uid,receipt);
  ELSIF p_op NOT IN ('approve','activate','deactivate','link') OR p_op IS NULL THEN RAISE EXCEPTION 'Invalid policy operation'; END IF;
  PERFORM 1 FROM public.products WHERE customer_id=cid AND deleted_at IS NULL FOR SHARE;
  PERFORM 1 FROM public.policy_review_reports WHERE customer_id=cid AND id=rid AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO STRICT rec FROM public.v_policy_review_state WHERE customer_id=cid AND id=rid;
  IF rec.review_revision IS DISTINCT FROM (p_input->>'revision')::bigint OR NOT (p_input ? 'basis') OR rec.product_basis IS DISTINCT FROM (p_input->>'basis') THEN RAISE EXCEPTION 'Policy review changed'; END IF;
  IF p_op='link' THEN
    IF NOT rec.is_current THEN RAISE EXCEPTION 'Policy review changed'; END IF;
    INSERT INTO public.policy_opportunity_report_links VALUES(oid_key,rid) ON CONFLICT DO NOTHING;
  ELSIF p_op='approve' THEN
    UPDATE public.policy_review_reports SET reviewed_at=clock_timestamp(),review_basis=rec.product_basis WHERE id=rid;
  ELSE
    UPDATE public.policy_review_reports SET review_valid=(p_op='activate') WHERE id=rid;
  END IF;
  RETURN jsonb_build_object('ok',true);
END
$service$;
REVOKE ALL ON FUNCTION public.crm_policy_service_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_policy_service_v1(text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.person_customer_worklist_v1(p_criteria jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
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
      'recruitment_priority','referral_priority','latest_followup_date','next_followup_date','wb_status','customer_id')
    OR v_dir IS NULL OR v_dir NOT IN ('asc','desc')
    OR coalesce(p_criteria->>'policyFilter','all') NOT IN ('all','review','renewal','verify')
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
        ((SELECT coalesce(jsonb_agg(r.role ORDER BY r.role),'[]'::jsonb)
          FROM public.person_roles r WHERE r.person_id=p.id AND r.role <> 'participant')
          || CASE WHEN participation.activity_count > 0 THEN '["participant"]'::jsonb ELSE '[]'::jsonb END) AS roles,
        participation.activity_count,participation.latest_activity_id,participation.latest_activity_name,
        participation.latest_activity_date,participation.latest_activity_status,
        f.followup_date AS latest_followup_date,f.next_followup_date,
        coalesce(f.followup_date,p.first_contact_date,(c.created_at AT TIME ZONE 'UTC')::date) AS last_contact_date
      FROM public.persons p
      LEFT JOIN LATERAL (
        SELECT count(*) AS activity_count,
          (array_agg(ev.id ORDER BY ev.activity_date DESC NULLS LAST,ev.id DESC))[1] AS latest_activity_id,
          (array_agg(ev.name ORDER BY ev.activity_date DESC NULLS LAST,ev.id DESC))[1] AS latest_activity_name,
          max(ev.activity_date) AS latest_activity_date,
          (array_agg(ev.status ORDER BY ev.activity_date DESC NULLS LAST,ev.id DESC))[1] AS latest_activity_status
        FROM (
          SELECT DISTINCT ON (a.id) a.id,a.name,a.activity_date,ap.status
          FROM public.activity_participants ap
          JOIN public.activities a ON a.id=ap.activity_id AND a.deleted_at IS NULL
          WHERE ap.canonical_person_id=p.id AND ap.deleted_at IS NULL
          ORDER BY a.id,ap.updated_at DESC NULLS LAST,ap.id DESC
        ) ev
      ) participation ON true
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
      SELECT * FROM scored s WHERE ($4='all' OR wb_status=$4) AND (
        $7='all' OR ($7='verify' AND EXISTS (
          SELECT 1 FROM public.v_policy_review_state r WHERE r.customer_id=s.customer_id AND r.is_valid AND NOT r.is_current
        )) OR ($7 IN ('review','renewal') AND EXISTS (
          SELECT 1 FROM public.v_policy_service_actions a WHERE a.customer_id=s.customer_id AND a.person_id=s.id AND a.service_kind=$7
            AND a.status IN ('open','in_progress') AND (a.due_at AT TIME ZONE 'Asia/Shanghai')::date <= $3+CASE WHEN $7='renewal' THEN 30 ELSE 0 END
        )))
    ), ordered AS (
      SELECT *,row_number() OVER(ORDER BY %s) AS ordinal FROM filtered
    )
    SELECT jsonb_build_object(
      'rows',coalesce((SELECT jsonb_agg(to_jsonb(x)-'ordinal'-'wb_sort' ORDER BY ordinal)
        FROM(SELECT * FROM ordered ORDER BY ordinal LIMIT $5 OFFSET $6)x),'[]'::jsonb),
      'total',(SELECT count(*) FROM filtered))
  $query$,v_order)
  INTO v_result USING btrim(v_keyword),v_priorities,v_today,v_status,v_size,(v_page-1)*v_size,coalesce(p_criteria->>'policyFilter','all');
  RETURN v_result || jsonb_build_object('page',v_page,'pageSize',v_size,
    'totalPages',greatest(1,ceil((v_result->>'total')::numeric/v_size)::integer),
    'hasMore',v_page*v_size<(v_result->>'total')::bigint,
    'sortField',v_field,'sortDir',v_dir,'asOfDate',v_today,'timezone','Asia/Shanghai');
END
$function$;
NOTIFY pgrst,'reload schema';
COMMIT;
