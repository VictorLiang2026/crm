-- P1 customer-linked opportunity terminal correction and soft delete.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $g$ BEGIN
 IF to_regclass('public.crm_legacy_opportunity_maintenance_commands') IS NOT NULL OR
    to_regprocedure('public.crm_legacy_opportunity_maintenance_v1(text,text,jsonb)') IS NOT NULL THEN
   RAISE EXCEPTION 'P1 maintenance objects already exist'; END IF;
END $g$;
CREATE TABLE public.crm_legacy_opportunity_maintenance_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_uid text NOT NULL CHECK(length(btrim(actor_uid)) BETWEEN 1 AND 128),
 idempotency_key uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('terminal_edit','remove')),
 customer_id integer NOT NULL,
 opportunity_id bigint NOT NULL,
 request jsonb NOT NULL,
 versions jsonb NOT NULL,
 preview jsonb NOT NULL,
 status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','executed')),
 result jsonb,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 executed_at timestamptz,
 UNIQUE(actor_uid,idempotency_key)
);
CREATE INDEX crm_legacy_opp_maintenance_actor_idx ON public.crm_legacy_opportunity_maintenance_commands(actor_uid,opportunity_id,created_at DESC);
ALTER TABLE public.crm_legacy_opportunity_maintenance_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_legacy_opportunity_maintenance_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_legacy_opportunity_maintenance_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_legacy_opportunity_maintenance_commands TO service_role;
CREATE POLICY crm_legacy_opp_maintenance_service_only ON public.crm_legacy_opportunity_maintenance_commands
 FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.crm_legacy_opportunity_maintenance_v1(p_actor_uid text,p_phase text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE cmd public.crm_legacy_opportunity_maintenance_commands%ROWTYPE;
 d jsonb; draft jsonb; customer_row jsonb; opp jsonb; before_value jsonb; after_value jsonb;
 customer_version text; opp_version text; versions_now jsonb; request_key uuid;
 customer_key integer; opp_key bigint; v_operation text; action_count bigint; outcome_count bigint;
 test_actor boolean; k text;
BEGIN
 IF current_user<>'service_role' OR p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 THEN
   RAISE EXCEPTION 'Invalid maintenance actor'; END IF;
 IF p_phase IS NULL OR p_phase NOT IN ('preview','execute') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Invalid maintenance phase'; END IF;
 IF p_phase='execute' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_data))<>1 OR NOT p_data ? 'previewId' THEN
     RAISE EXCEPTION 'Invalid maintenance execution'; END IF;
   SELECT * INTO cmd FROM public.crm_legacy_opportunity_maintenance_commands
     WHERE id=(p_data->>'previewId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Invalid maintenance preview'; END IF;
   IF cmd.status='executed' THEN RETURN cmd.result||jsonb_build_object('replayed',true); END IF;
   IF cmd.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Maintenance preview expired'; END IF;
   d:=cmd.request;
 ELSE d:=p_data; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(d))<>5 OR EXISTS(
   SELECT 1 FROM jsonb_object_keys(d) x WHERE x NOT IN ('idempotencyKey','operation','customerId','opportunityId','draft')) OR
   coalesce(d->>'operation','') NOT IN ('terminal_edit','remove') OR
   coalesce(d->>'customerId','') !~ '^[1-9][0-9]{0,9}$' OR
   coalesce(d->>'opportunityId','') !~ '^[1-9][0-9]{0,15}$' OR
   jsonb_typeof(d->'draft') IS DISTINCT FROM 'object' OR length(d::text)>16000 THEN
   RAISE EXCEPTION 'Invalid maintenance request'; END IF;
 request_key:=(d->>'idempotencyKey')::uuid;
 IF request_key IS NULL THEN RAISE EXCEPTION 'Invalid maintenance key'; END IF;
 customer_key:=(d->>'customerId')::integer;opp_key:=(d->>'opportunityId')::bigint;
 v_operation:=d->>'operation';draft:=d->'draft';
 IF p_phase='preview' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('legacy-maintenance:'||p_actor_uid||':'||request_key::text,0));
   SELECT * INTO cmd FROM public.crm_legacy_opportunity_maintenance_commands
     WHERE actor_uid=p_actor_uid AND idempotency_key=request_key FOR UPDATE;
   IF FOUND THEN
     IF cmd.request<>d THEN RAISE EXCEPTION 'Maintenance idempotency conflict'; END IF;
     RETURN jsonb_build_object('previewId',cmd.id,'preview',cmd.preview,'expiresAt',cmd.expires_at,
       'status',cmd.status,'result',cmd.result,'replayed',true,'businessDataWritten',false);
   END IF;
 END IF;
 SELECT to_jsonb(c),c.xmin::text INTO customer_row,customer_version FROM public.customers c
   WHERE c."Id"=customer_key AND c.deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable'; END IF;
 SELECT to_jsonb(o),o.xmin::text INTO opp,opp_version FROM public.opportunities o
   WHERE o.id=opp_key AND o.customer_id=customer_key AND o.deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity unavailable or customer changed'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) INTO test_actor;
 IF test_actor AND EXISTS(SELECT 1 FROM (VALUES('customers',customer_key::text),('opportunities',opp_key::text)) x(tbl,rid)
   WHERE NOT EXISTS(SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b ON b.batch_key=r.batch_key
     WHERE b.created_by_uid=p_actor_uid AND r.record_table=x.tbl AND r.record_id=x.rid)) THEN
   RAISE EXCEPTION 'Test account requires tracked fictional customer and Opportunity'; END IF;
 IF v_operation='terminal_edit' THEN
   IF opp->>'status' NOT IN ('成交','关闭') OR
      (SELECT count(*) FROM jsonb_object_keys(draft))<>8 OR EXISTS(
       SELECT 1 FROM jsonb_object_keys(draft) x WHERE x NOT IN
         ('type','status','progress','nextAction','nextActionDate','discoveredAt','referredName','referredRelation')) OR
      coalesce(draft->>'status','') NOT IN ('发现','沟通','方案','潜在线索','已介绍','已联系','已建立关系','成交','关闭') OR
      coalesce(draft->>'type','') NOT IN ('医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障','转介绍',
        'insurance','recruit','referral','activity','speaker','partnership','service','relationship') THEN
     RAISE EXCEPTION 'Invalid terminal correction'; END IF;
   IF (draft->>'type' IN ('转介绍','referral') AND draft->>'status' NOT IN
         ('潜在线索','已介绍','已联系','已建立关系','成交','关闭')) OR
      (draft->>'type' NOT IN ('转介绍','referral') AND draft->>'status' NOT IN
         ('发现','沟通','方案','成交','关闭')) THEN
     RAISE EXCEPTION 'Invalid correction type and stage'; END IF;
   FOREACH k IN ARRAY ARRAY['type','status','progress','nextAction','referredName','referredRelation'] LOOP
     IF jsonb_typeof(draft->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid correction text'; END IF;
   END LOOP;
   IF length(draft->>'progress')>4000 OR length(draft->>'nextAction')>1000 OR
      length(draft->>'referredName')>160 OR length(draft->>'referredRelation')>200 THEN
     RAISE EXCEPTION 'Correction text too long'; END IF;
   FOREACH k IN ARRAY ARRAY['nextActionDate','discoveredAt'] LOOP
     IF jsonb_typeof(draft->k) NOT IN ('string','null') OR
       (draft->>k IS NOT NULL AND draft->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
       RAISE EXCEPTION 'Invalid correction date'; END IF;
     PERFORM (draft->>k)::date;
   END LOOP;
 ELSE
   IF draft<>'{}'::jsonb THEN RAISE EXCEPTION 'Remove draft must be empty'; END IF;
 END IF;
 SELECT count(*) INTO action_count FROM public.actions WHERE opportunity_id=opp_key;
 SELECT count(*) INTO outcome_count FROM public.outcomes WHERE opportunity_id=opp_key;
 versions_now:=jsonb_build_object('customer',customer_version,'opportunity',opp_version,
   'actions',action_count,'outcomes',outcome_count);
 before_value:=jsonb_build_object('type',opp->'opportunity_type','status',opp->'status','progress',opp->'last_progress',
   'nextAction',opp->'next_action','nextActionDate',opp->'next_action_date','discoveredAt',opp->'discovered_at',
   'referredName',opp->'referred_name','referredRelation',opp->'referred_relation');
 after_value:=CASE WHEN v_operation='terminal_edit' THEN before_value||draft ELSE before_value END;
 IF p_phase='preview' THEN
   INSERT INTO public.crm_legacy_opportunity_maintenance_commands
     (actor_uid,idempotency_key,operation,customer_id,opportunity_id,request,versions,preview)
     VALUES(p_actor_uid,request_key,v_operation,customer_key,opp_key,d,versions_now,
       jsonb_build_object('operation',v_operation,'customerId',customer_key,'opportunityId',opp_key,
         'personId',customer_row->'person_id','before',before_value,'after',after_value,
         'linkedActionCount',action_count,'outcomeCount',outcome_count,
         'effect',CASE WHEN v_operation='remove' THEN 'soft_delete_opportunity_only' ELSE 'correct_terminal_fields_only' END))
     RETURNING * INTO cmd;
   RETURN jsonb_build_object('previewId',cmd.id,'preview',cmd.preview,'expiresAt',cmd.expires_at,
     'status','preview','businessDataWritten',false);
 END IF;
 IF versions_now IS DISTINCT FROM cmd.versions THEN
   RAISE EXCEPTION 'Opportunity or linked records changed; preview again' USING ERRCODE='40001'; END IF;
 IF v_operation='terminal_edit' THEN
   UPDATE public.opportunities SET opportunity_type=draft->>'type',status=draft->>'status',
     last_progress=draft->>'progress',next_action=draft->>'nextAction',
     next_action_date=(draft->>'nextActionDate')::date,discovered_at=(draft->>'discoveredAt')::date,
     referred_name=draft->>'referredName',referred_relation=draft->>'referredRelation',
     updated_at=clock_timestamp() WHERE id=opp_key;
 ELSE
   UPDATE public.opportunities SET deleted_at=clock_timestamp(),updated_at=clock_timestamp()
     WHERE id=opp_key;
 END IF;
 UPDATE public.crm_legacy_opportunity_maintenance_commands SET status='executed',executed_at=clock_timestamp(),
   result=jsonb_build_object('opportunityId',opp_key,'customerId',customer_key,'operation',v_operation,
     'linkedActionCount',action_count,'outcomeCount',outcome_count,'replayed',false)
   WHERE id=cmd.id RETURNING * INTO cmd;
 RETURN cmd.result;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_legacy_opportunity_maintenance_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_legacy_opportunity_maintenance_v1(text,text,jsonb) TO service_role;

CREATE FUNCTION public.crm_legacy_opportunity_identity_exceptions_v1(p_actor_uid text,p_page integer,p_page_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE result jsonb; test_actor boolean;
BEGIN
 IF current_user<>'service_role' OR p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR
    p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 50 THEN
   RAISE EXCEPTION 'Invalid identity exception request'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) INTO test_actor;
 WITH exceptions AS MATERIALIZED (
   SELECT o.id AS "opportunityId",o.customer_id AS "customerId",o.person_id AS "opportunityPersonId",
     c.person_id AS "customerPersonId",cp.display_name AS "customerPersonName",
     op.display_name AS "opportunityPersonName",o.status,
     CASE WHEN c."Id" IS NULL OR c.deleted_at IS NOT NULL THEN 'customer_unavailable'
       WHEN c.person_id IS NULL THEN 'customer_person_missing'
       WHEN cp.id IS NULL THEN 'customer_person_unavailable'
       WHEN o.person_id IS NULL THEN 'opportunity_person_missing'
       WHEN op.id IS NULL THEN 'opportunity_person_unavailable'
       WHEN o.person_id<>c.person_id THEN 'person_conflict' END AS reason
   FROM public.opportunities o
   LEFT JOIN public.customers c ON c."Id"=o.customer_id
   LEFT JOIN public.persons cp ON cp.id=c.person_id AND cp.deleted_at IS NULL
   LEFT JOIN public.persons op ON op.id=o.person_id AND op.deleted_at IS NULL
   WHERE o.customer_id IS NOT NULL AND o.deleted_at IS NULL
     AND (c."Id" IS NULL OR c.deleted_at IS NOT NULL OR c.person_id IS NULL OR cp.id IS NULL OR
       o.person_id IS NULL OR op.id IS NULL OR o.person_id<>c.person_id)
     AND (NOT test_actor OR EXISTS(SELECT 1 FROM public.crm_test_records r
       JOIN public.crm_test_batches b ON b.batch_key=r.batch_key
       WHERE b.created_by_uid=p_actor_uid AND r.record_table='opportunities' AND r.record_id=o.id::text))
 )
 SELECT jsonb_build_object('total',(SELECT count(*) FROM exceptions),
   'rows',coalesce((SELECT jsonb_agg(to_jsonb(page_rows)) FROM (
     SELECT * FROM exceptions ORDER BY "opportunityId" DESC
       LIMIT p_page_size OFFSET (p_page-1)*p_page_size) page_rows),'[]'::jsonb)) INTO result;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_legacy_opportunity_identity_exceptions_v1(text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_legacy_opportunity_identity_exceptions_v1(text,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
