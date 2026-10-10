CREATE OR REPLACE FUNCTION public.crm_test_scenario_v1(p_stage text, p_actor_uid text, p_preview_id uuid DEFAULT NULL::uuid, p_preview_hash text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
DECLARE batch constant text := 'crm_test_main_v1'; marker constant text := '【系统测试·勿联系】';
 person_name constant text := '【系统测试·勿联系】虚构体验甲'; today date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
 total_initial integer; own_initial integer; plan jsonb; fingerprint text; token public.crm_test_previews%ROWTYPE;
 customer_id integer; person_id bigint; role_customer bigint; role_participant bigint; followup_id integer;
 interaction_id bigint; opportunity_id bigint; action_id bigint; activity_id bigint; participant_id bigint;
 item record; exists_row boolean; targets jsonb; result jsonb; trigger_hash text;
BEGIN
 IF p_stage IS NULL OR p_stage NOT IN ('status','dryRun','confirm','execute') OR nullif(btrim(p_actor_uid),'') IS NULL OR length(p_actor_uid)>128 THEN
  RAISE EXCEPTION 'Invalid scenario request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(20261003,3);
 SELECT count(*),count(*) FILTER(WHERE batch_key=batch) INTO total_initial,own_initial FROM public.crm_test_records WHERE origin='initial';
 IF total_initial>10 OR own_initial NOT IN (0,10) THEN RAISE EXCEPTION 'Invalid initial manifest' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_object_agg(seed_key,record_id),'{}') INTO targets FROM public.crm_test_records WHERE batch_key=batch AND origin='initial';
 FOR item IN SELECT record_table,record_id FROM public.crm_test_records WHERE batch_key=batch AND origin='initial' LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I::text=$1)',item.record_table,CASE WHEN item.record_table IN ('customers','followups') THEN 'Id' ELSE 'id' END) INTO exists_row USING item.record_id;
  IF NOT exists_row THEN RAISE EXCEPTION 'A seed row is missing; restoration requires review' USING ERRCODE='23514'; END IF;
 END LOOP;
 result := jsonb_build_object('ok',true,'batchKey',batch,'initialCount',total_initial,'ready',own_initial=10,
  'derivedCount',(SELECT count(*) FROM public.crm_test_records WHERE batch_key=batch AND origin='derived'),
  'auditCount',(SELECT count(*) FROM public.crm_test_records WHERE batch_key=batch AND origin='ai_audit'),
  'targets',jsonb_build_object('personId',targets->>'person','customerId',targets->>'customer','activityId',targets->>'activity'),
  'marker',marker,'outbound',false);
 IF p_stage='status' THEN RETURN result; END IF;
 IF EXISTS (
  SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
   AND c.relname IN ('persons','customers','person_roles','followups','interactions','opportunities','actions','activities','activity_participants')
   AND NOT (t.tgname='zz_crm_test_track' AND t.tgfoid='public.crm_test_track_v1()'::regprocedure
    OR c.relname='actions' AND t.tgname='actions_guard_before_write' AND md5(pg_get_functiondef(t.tgfoid))='3d9721447fc893d76f4d08dc57cb39a7'
    OR c.relname='activity_participants' AND t.tgname='activity_participants_canonical_guard_trigger' AND md5(pg_get_functiondef(t.tgfoid))='34fdfcd27872433edd2b10b9e84ff876')
 ) THEN RAISE EXCEPTION 'Unreviewed seed trigger; dry-run counts require review' USING ERRCODE='23514'; END IF;
 IF own_initial=0 AND total_initial+10>10 THEN RAISE EXCEPTION 'Initial limit exceeded' USING ERRCODE='23514'; END IF;
 -- PMC-19 CL-02: identity collision check via persons JOIN (customer_name column removed)
 IF EXISTS(SELECT 1 FROM public.persons p WHERE p.name_key=lower(person_name) AND p.id::text IS DISTINCT FROM targets->>'person')
   OR EXISTS(SELECT 1 FROM public.customers c JOIN public.persons p ON c.person_id=p.id
             WHERE p.display_name=person_name AND c."Id"::text IS DISTINCT FROM targets->>'customer') THEN
  RAISE EXCEPTION 'Identity collision; never reuse an unregistered person' USING ERRCODE='23514'; END IF;
 SELECT md5(coalesce(string_agg(pg_get_triggerdef(t.oid)||pg_get_functiondef(t.tgfoid),'|' ORDER BY c.relname,t.tgname),'')) INTO trigger_hash
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname IN ('persons','customers','person_roles','followups','interactions','opportunities','actions','activities','activity_participants');
 plan := jsonb_build_object('batchKey',batch,'version',1,'personName',person_name,'date',today,
  'initialExisting',total_initial,'initialNew',CASE WHEN own_initial=10 THEN 0 ELSE 10 END,
  'initialTotal',CASE WHEN own_initial=10 THEN total_initial ELSE total_initial+10 END,'maximum',10,
  'triggerBusinessRows',0,'outbound',false,'triggerHash',trigger_hash,
  'rows','[{"table":"persons","count":1},{"table":"customers","count":1},{"table":"person_roles","count":2},{"table":"followups","count":1},{"table":"interactions","count":1},{"table":"opportunities","count":1},{"table":"actions","count":1},{"table":"activities","count":1},{"table":"activity_participants","count":1}]'::jsonb);
 fingerprint := md5(plan::text);
 IF p_stage='dryRun' THEN
  INSERT INTO public.crm_test_previews(actor_uid,batch_key,preview,preview_hash) VALUES(p_actor_uid,batch,plan,fingerprint) RETURNING * INTO token;
  RETURN result || jsonb_build_object('stage','dryRun','previewId',token.id,'previewHash',fingerprint,'expiresAt',token.expires_at,'preview',plan,'businessDataWritten',false);
 END IF;
 SELECT * INTO token FROM public.crm_test_previews WHERE id=p_preview_id AND actor_uid=p_actor_uid AND batch_key=batch FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Confirmation required' USING ERRCODE='42501'; END IF;
 IF p_stage='execute' AND token.executed_at IS NOT NULL THEN RETURN result || jsonb_build_object('stage','execute','replayed',true,'businessDataWritten',false); END IF;
 IF token.expires_at<=now() OR token.preview_hash<>fingerprint THEN RAISE EXCEPTION 'Preview is stale' USING ERRCODE='40001'; END IF;
 IF p_stage='confirm' THEN
  IF p_preview_hash IS DISTINCT FROM token.preview_hash THEN RAISE EXCEPTION 'Confirmation required' USING ERRCODE='42501'; END IF;
  UPDATE public.crm_test_previews SET confirmed_at=now() WHERE id=token.id;
  RETURN result || jsonb_build_object('stage','confirm','businessDataWritten',false);
 END IF;
 IF token.confirmed_at IS NULL THEN RAISE EXCEPTION 'Confirmation required' USING ERRCODE='42501'; END IF;
 IF own_initial=0 THEN
  INSERT INTO public.crm_test_batches(batch_key,created_by_uid) VALUES(batch,p_actor_uid);
  PERFORM set_config('crm.test_initial_batch',batch,true);
  INSERT INTO public.persons(display_name,name_key,source,notes)
   VALUES(person_name,lower(person_name),batch,marker||'纯虚构身份') RETURNING id INTO person_id;
  INSERT INTO public.person_roles(person_id,role,origin) VALUES(person_id,'customer','manual') RETURNING id INTO role_customer;
  INSERT INTO public.person_roles(person_id,role,origin) VALUES(person_id,'participant','manual') RETURNING id INTO role_participant;
  -- PMC-19 CL-02: customers 副本列已退出，仅写 person_id + 业务列
  INSERT INTO public.customers(person_id,source,additional_info,next_action,next_action_date,first_contact_date)
   VALUES(person_id,batch,marker||'纯虚构，无联系方式，无保单',marker||'核对测试场景',today,today-2) RETURNING "Id" INTO customer_id;
  INSERT INTO public.followups(customer_id,customer_name,followup_notes,followup_date,next_followup_date,next_followup_goal,created_at)
   VALUES(customer_id,person_name,marker||'活动前的虚构沟通',today-2,today,marker||'仅在系统内记录测试结果',now()) RETURNING "Id" INTO followup_id;
  INSERT INTO public.interactions(person_id,interaction_type,interaction_at,summary,source_type,created_by_uid)
   VALUES(person_id,'conversation',(today-2)::timestamp AT TIME ZONE 'Asia/Shanghai',marker||'活动前的虚构互动','manual',p_actor_uid) RETURNING id INTO interaction_id;
  INSERT INTO public.opportunities(customer_id,person_id,opportunity_type,status,discovered_at,last_progress,next_action,next_action_date)
   VALUES(customer_id,person_id,'其他','发现',today,marker||'虚构机会，无真实保单',marker||'核对虚构机会',today) RETURNING id INTO opportunity_id;
  INSERT INTO public.actions(person_id,opportunity_id,interaction_id,action_type,title,description,due_at,source,created_by_uid)
   VALUES(person_id,opportunity_id,interaction_id,'other',marker||'核对体验流程',marker||'仅系统内测试，不联系不外发',
    (today::timestamp + interval '18 hours') AT TIME ZONE 'Asia/Shanghai',batch,p_actor_uid) RETURNING id INTO action_id;
  INSERT INTO public.activities(name,activity_date,activity_type,description,status)
   VALUES(marker||'虚构体验活动',today,'其他',marker||'虚构到场场景，不发通知','ended') RETURNING id INTO activity_id;
  INSERT INTO public.activity_participants(activity_id,person_type,person_id,canonical_person_id,person_name,status,followup_status,relationship_note)
   VALUES(activity_id,'person',person_id,person_id,person_name,'attended','none',marker||'虚构到场记录') RETURNING id INTO participant_id;
  INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,initial_slot,seed_key,visible_label)
   SELECT batch,t,id::text,'initial',slot,key,marker||label FROM (VALUES
    ('customers',customer_id::bigint,1::smallint,'customer','客户'),('persons',person_id,2,'person','人物'),
    ('person_roles',role_customer,3,'customer_role','客户角色'),('person_roles',role_participant,4,'participant_role','参与者角色'),
    ('followups',followup_id,5,'followup','跟进'),('interactions',interaction_id,6,'interaction','互动'),
    ('opportunities',opportunity_id,7,'opportunity','机会'),('actions',action_id,8,'action','行动'),
    ('activities',activity_id,9,'activity','活动'),('activity_participants',participant_id,10,'participant','到场')) AS v(t,id,slot,key,label);
  PERFORM set_config('crm.test_initial_batch','',true);
 END IF;
 UPDATE public.crm_test_previews SET executed_at=now() WHERE id=token.id;
 RETURN public.crm_test_scenario_v1('status',p_actor_uid) || jsonb_build_object('stage','execute','replayed',own_initial=10,'businessDataWritten',own_initial=0);
END
$function$;
