-- M10: customer-linked Opportunity adapter. Person-only RPCs and legacy CRUD are unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF to_regclass('public.crm_legacy_opportunity_commands') IS NOT NULL OR
    to_regprocedure('public.crm_legacy_opportunity_v1(text,text,jsonb)') IS NOT NULL THEN
   RAISE EXCEPTION 'M10 objects already exist; inspect before migration';
 END IF;
END $guard$;
CREATE TABLE public.crm_legacy_opportunity_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_uid text NOT NULL CHECK(length(btrim(actor_uid)) BETWEEN 1 AND 128),
 idempotency_key uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('edit','stage','close')),
 -- Audit identifiers intentionally do not change old delete/restore behavior via FKs.
 person_id bigint NOT NULL,
 customer_id integer NOT NULL,
 opportunity_id bigint NOT NULL,
 request jsonb NOT NULL,
 versions jsonb NOT NULL,
 preview jsonb NOT NULL,
 status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','executed')),
 result jsonb,
 expires_at timestamptz NOT NULL DEFAULT(clock_timestamp()+interval '15 minutes'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 executed_at timestamptz,
 UNIQUE(actor_uid,idempotency_key)
);
CREATE INDEX crm_legacy_opportunity_commands_actor_idx ON public.crm_legacy_opportunity_commands(actor_uid,opportunity_id,created_at DESC);
ALTER TABLE public.crm_legacy_opportunity_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_legacy_opportunity_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_legacy_opportunity_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_legacy_opportunity_commands TO service_role;
CREATE POLICY crm_legacy_opportunity_commands_service_only ON public.crm_legacy_opportunity_commands FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.crm_legacy_opportunity_v1(p_actor_uid text,p_operation text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE cmd public.crm_legacy_opportunity_commands%ROWTYPE;
 d jsonb; payload jsonb; person_row jsonb; customer_row jsonb; opp jsonb; action_row jsonb;
 person_version text; customer_version text; opp_version text; action_version text;
 person_key bigint; customer_key integer; opp_key bigint; action_key bigint; request_key uuid;
 versions_now jsonb; before_value jsonb; after_value jsonb; outcome_key bigint; v_operation text; effective_type text;
 k text; test_actor boolean;
BEGIN
 IF current_user<>'service_role' OR p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 THEN
   RAISE EXCEPTION 'Invalid legacy Opportunity actor'; END IF;
 IF p_operation IS NULL OR p_operation NOT IN ('preview','execute') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Invalid legacy Opportunity operation'; END IF;
 IF p_operation='execute' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_data))<>1 OR NOT p_data ? 'previewId' THEN
     RAISE EXCEPTION 'Invalid legacy Opportunity execution'; END IF;
   SELECT * INTO cmd FROM public.crm_legacy_opportunity_commands
     WHERE id=(p_data->>'previewId')::uuid AND actor_uid=p_actor_uid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Invalid legacy Opportunity preview'; END IF;
   IF cmd.status='executed' THEN RETURN cmd.result||jsonb_build_object('replayed',true); END IF;
   IF cmd.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Opportunity preview expired; preview again'; END IF;
   d:=cmd.request;
 ELSE d:=p_data; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(d))<>6 OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) AS keys(key)
      WHERE keys.key NOT IN ('idempotencyKey','operation','personId','customerId','opportunityId','draft')) OR
    coalesce(d->>'operation','') NOT IN ('edit','stage','close') OR
    coalesce(d->>'personId','') !~ '^[1-9][0-9]{0,15}$' OR
    coalesce(d->>'customerId','') !~ '^[1-9][0-9]{0,9}$' OR
    coalesce(d->>'opportunityId','') !~ '^[1-9][0-9]{0,15}$' OR
    jsonb_typeof(d->'draft') IS DISTINCT FROM 'object' OR length(d::text)>16000 THEN
   RAISE EXCEPTION 'Invalid legacy Opportunity payload'; END IF;
 person_key:=(d->>'personId')::bigint;customer_key:=(d->>'customerId')::integer;
 opp_key:=(d->>'opportunityId')::bigint;request_key:=(d->>'idempotencyKey')::uuid;
 v_operation:=d->>'operation';payload:=d->'draft';
 IF request_key IS NULL THEN RAISE EXCEPTION 'Invalid legacy Opportunity request'; END IF;
 IF p_operation='preview' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('legacy-opportunity:'||p_actor_uid||':'||request_key::text,0));
   SELECT * INTO cmd FROM public.crm_legacy_opportunity_commands WHERE actor_uid=p_actor_uid AND idempotency_key=request_key FOR UPDATE;
   IF FOUND THEN
     IF cmd.request<>d THEN RAISE EXCEPTION 'Idempotency key conflicts with Opportunity request'; END IF;
     RETURN jsonb_build_object('previewId',cmd.id,'preview',cmd.preview,'expiresAt',cmd.expires_at,
       'status',cmd.status,'result',cmd.result,'replayed',true,'businessDataWritten',false);
   END IF;
 END IF;
 SELECT to_jsonb(p),p.xmin::text INTO person_row,person_version FROM public.persons p
   WHERE p.id=person_key AND p.deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity Person unavailable'; END IF;
 SELECT to_jsonb(c),c.xmin::text INTO customer_row,customer_version FROM public.customers c
   WHERE c."Id"=customer_key AND c.person_id=person_key AND c.deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity customer association changed'; END IF;
 SELECT to_jsonb(o),o.xmin::text INTO opp,opp_version FROM public.opportunities o
   WHERE o.id=opp_key AND o.customer_id=customer_key AND o.deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR (opp->>'person_id' IS NOT NULL AND (opp->>'person_id')::bigint<>person_key) THEN
   RAISE EXCEPTION 'Opportunity customer or Person association changed'; END IF;
 IF opp->>'status' IN ('成交','关闭') THEN RAISE EXCEPTION 'Opportunity already closed'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) INTO test_actor;
 IF test_actor AND EXISTS(SELECT 1 FROM (VALUES('persons',person_key::text),('customers',customer_key::text),('opportunities',opp_key::text)) x(tbl,rid)
   WHERE NOT EXISTS(SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b ON b.batch_key=r.batch_key
     WHERE b.created_by_uid=p_actor_uid AND r.record_table=x.tbl AND r.record_id=x.rid)) THEN
   RAISE EXCEPTION 'Test account requires tracked fictional Opportunity and identities'; END IF;
 effective_type:=CASE WHEN v_operation='edit' THEN payload->>'type' ELSE opp->>'opportunity_type' END;
 IF coalesce(effective_type,'') NOT IN ('医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障','转介绍',
   'insurance','recruit','referral','activity','speaker','partnership','service','relationship') THEN
   RAISE EXCEPTION 'Invalid legacy Opportunity type'; END IF;
 IF v_operation='edit' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(payload))<>8 OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) x
      WHERE x NOT IN ('type','status','progress','nextAction','nextActionDate','discoveredAt','referredName','referredRelation')) THEN
     RAISE EXCEPTION 'Invalid legacy Opportunity edit fields'; END IF;
   FOREACH k IN ARRAY ARRAY['type','status','progress','nextAction','referredName','referredRelation'] LOOP
     IF jsonb_typeof(payload->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid legacy Opportunity text'; END IF;
   END LOOP;
   IF length(payload->>'progress')>4000 OR length(payload->>'nextAction')>1000 OR
      length(payload->>'referredName')>160 OR length(payload->>'referredRelation')>200 THEN RAISE EXCEPTION 'Invalid legacy Opportunity text'; END IF;
   FOREACH k IN ARRAY ARRAY['nextActionDate','discoveredAt'] LOOP
     IF jsonb_typeof(payload->k) NOT IN ('string','null') OR
        (payload->>k IS NOT NULL AND payload->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN RAISE EXCEPTION 'Invalid legacy Opportunity date'; END IF;
     PERFORM (payload->>k)::date;
   END LOOP;
 ELSIF v_operation='stage' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(payload))<>1 OR jsonb_typeof(payload->'status') IS DISTINCT FROM 'string' THEN
     RAISE EXCEPTION 'Invalid legacy Opportunity stage'; END IF;
 ELSE
   IF (SELECT count(*) FROM jsonb_object_keys(payload))<>3 OR NOT(payload ? 'status' AND payload ? 'result' AND payload ? 'actionId') OR
      coalesce(payload->>'status','') NOT IN ('成交','关闭') OR jsonb_typeof(payload->'result') IS DISTINCT FROM 'string' OR
      length(btrim(payload->>'result')) NOT BETWEEN 1 AND 4000 OR jsonb_typeof(payload->'actionId') NOT IN ('string','null') THEN
     RAISE EXCEPTION 'Invalid legacy Opportunity closing result'; END IF;
   IF test_actor AND position('【系统测试·勿联系】' IN payload->>'result')=0 THEN RAISE EXCEPTION 'Test account Outcome text must be marked'; END IF;
   IF payload->>'actionId' IS NOT NULL THEN
     IF payload->>'actionId' !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'Invalid legacy Opportunity Action'; END IF;
     action_key:=(payload->>'actionId')::bigint;
     SELECT to_jsonb(a),a.xmin::text INTO action_row,action_version FROM public.actions a
       WHERE a.id=action_key AND a.person_id=person_key AND a.opportunity_id=opp_key FOR SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Action is not linked to this Opportunity and Person'; END IF;
     IF test_actor AND NOT EXISTS(SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b ON b.batch_key=r.batch_key
       WHERE b.created_by_uid=p_actor_uid AND r.record_table='actions' AND r.record_id=action_key::text) THEN
       RAISE EXCEPTION 'Test account requires tracked fictional Action'; END IF;
   END IF;
 END IF;
 IF v_operation<>'close' AND ((effective_type IN ('转介绍','referral') AND coalesce(payload->>'status','') NOT IN ('潜在线索','已介绍','已联系','已建立关系')) OR
    (effective_type NOT IN ('转介绍','referral') AND coalesce(payload->>'status','') NOT IN ('发现','沟通','方案'))) THEN
   RAISE EXCEPTION 'Invalid legacy Opportunity type and stage combination'; END IF;
 versions_now:=jsonb_build_object('person',person_version,'customer',customer_version,'opportunity',opp_version,'action',action_version);
 before_value:=jsonb_build_object('type',opp->'opportunity_type','status',opp->'status','progress',opp->'last_progress',
   'nextAction',opp->'next_action','nextActionDate',opp->'next_action_date','discoveredAt',opp->'discovered_at',
   'referredName',opp->'referred_name','referredRelation',opp->'referred_relation');
 after_value:=before_value||payload;
 IF p_operation='preview' THEN
   INSERT INTO public.crm_legacy_opportunity_commands(actor_uid,idempotency_key,operation,person_id,customer_id,opportunity_id,request,versions,preview)
     VALUES(p_actor_uid,request_key,v_operation,person_key,customer_key,opp_key,d,versions_now,
       jsonb_build_object('operation',v_operation,'personId',person_key,'personName',person_row->>'display_name','customerId',customer_key,
         'opportunityId',opp_key,'before',before_value,'after',after_value,'source','public.opportunities#'||opp_key::text)) RETURNING * INTO cmd;
   RETURN jsonb_build_object('previewId',cmd.id,'preview',cmd.preview,'expiresAt',cmd.expires_at,'status','preview','businessDataWritten',false);
 END IF;
 IF versions_now IS DISTINCT FROM cmd.versions THEN RAISE EXCEPTION 'Opportunity or linked identity changed; preview again' USING ERRCODE='40001'; END IF;
 IF v_operation='edit' THEN
   UPDATE public.opportunities SET opportunity_type=payload->>'type',status=payload->>'status',last_progress=payload->>'progress',
     next_action=payload->>'nextAction',next_action_date=(payload->>'nextActionDate')::date,discovered_at=(payload->>'discoveredAt')::date,
     referred_name=payload->>'referredName',referred_relation=payload->>'referredRelation',updated_at=clock_timestamp() WHERE id=opp_key;
 ELSE
   UPDATE public.opportunities SET status=payload->>'status',updated_at=clock_timestamp() WHERE id=opp_key;
   IF v_operation='close' THEN
     INSERT INTO public.outcomes(opportunity_id,action_id,outcome_type,result,occurred_at,recorded_by_uid,idempotency_key)
       VALUES(opp_key,action_key,CASE WHEN payload->>'status'='成交' THEN 'opportunity_sale' ELSE 'opportunity_closed' END,
         btrim(payload->>'result'),clock_timestamp(),p_actor_uid,cmd.id) RETURNING id INTO outcome_key;
   END IF;
 END IF;
 UPDATE public.crm_legacy_opportunity_commands SET status='executed',executed_at=clock_timestamp(),
   result=jsonb_build_object('opportunityId',opp_key,'outcomeId',outcome_key,'operation',v_operation,'replayed',false)
   WHERE id=cmd.id RETURNING * INTO cmd;
 RETURN cmd.result;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_legacy_opportunity_v1(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_legacy_opportunity_v1(text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
