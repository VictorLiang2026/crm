-- WP03: fixed ten-row scenario, server-only confirmations and atomic provenance.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.crm_test_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
 batch_key text NOT NULL CHECK (batch_key = 'crm_test_main_v1'),
 preview jsonb NOT NULL CHECK (jsonb_typeof(preview) = 'object'),
 preview_hash text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
 confirmed_at timestamptz,
 executed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_test_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_test_previews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_test_previews FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_test_previews TO service_role;
CREATE POLICY crm_test_previews_service_only ON public.crm_test_previews FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Explicit references only: never infer provenance from a person's name or free text.
CREATE FUNCTION public.crm_test_refs_v1(p_row jsonb, p_table text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $fn$
DECLARE refs jsonb := '[]'; field text; target text; item jsonb;
BEGIN
 FOR field,target IN SELECT * FROM (VALUES
  ('customer_id','customers'),('legacy_customer_id','customers'),
  ('canonical_person_id','persons'),('from_person_id','persons'),('to_person_id','persons'),
  ('introduced_by_person_id','persons'),('anchor_person_id','persons'),
  ('household_id','households'),('interaction_id','interactions'),('opportunity_id','opportunities'),
  ('activity_id','activities'),('action_id','actions'),('recruit_candidate_id','recruit_candidates'),
  ('candidate_id','recruit_candidates'),('ai_result_id','ai_results'),('task_id','ai_tasks'),
  ('run_id','ai_runs'),('recommendation_id','ai_recommendations')) AS m(f,t)
 LOOP
  IF p_row->>field IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('table',target,'id',p_row->>field)); END IF;
 END LOOP;
 IF p_row->>'person_id' IS NOT NULL THEN
  target := CASE WHEN p_table = 'activity_participants' THEN
    CASE p_row->>'person_type' WHEN 'customer' THEN 'customers' WHEN 'recruit' THEN 'recruit_candidates' WHEN 'person' THEN 'persons' END
    ELSE 'persons' END;
  IF target IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('table',target,'id',p_row->>'person_id')); END IF;
 END IF;
 IF p_row->>'source_id' IS NOT NULL THEN
  target := coalesce(p_row->>'source_table',p_row->>'source_type');
  refs := refs || jsonb_build_array(jsonb_build_object('table',target,'id',p_row->>'source_id'));
 END IF;
 IF p_table = 'ai_tasks' AND p_row->>'subject_id' IS NOT NULL THEN
  target := CASE p_row->>'subject_type' WHEN 'person' THEN 'persons' WHEN 'customer' THEN 'customers'
   WHEN 'activity' THEN 'activities' WHEN 'opportunity' THEN 'opportunities' WHEN 'recruit' THEN 'recruit_candidates' END;
  IF target IS NOT NULL THEN refs := refs || jsonb_build_array(jsonb_build_object('table',target,'id',p_row->>'subject_id')); END IF;
 END IF;
 -- Context Engine / evidence contracts use {schema:'public',table,id}.
 FOR item IN WITH RECURSIVE walk(v) AS (
  SELECT p_row UNION ALL
  SELECT child.v FROM walk w CROSS JOIN LATERAL (
   SELECT value AS v FROM jsonb_each(CASE WHEN jsonb_typeof(w.v)='object' THEN w.v ELSE '{}'::jsonb END)
   UNION ALL SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.v)='array' THEN w.v ELSE '[]'::jsonb END)
  ) child
 ) SELECT v FROM walk WHERE jsonb_typeof(v)='object' AND v->>'schema'='public' AND v ? 'table' AND v ? 'id'
 LOOP refs := refs || jsonb_build_array(jsonb_build_object('table',item->>'table','id',item->>'id')); END LOOP;
 RETURN refs;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_test_refs_v1(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_test_refs_v1(jsonb,text) TO service_role;

-- The trigger runs in the same transaction as the originating normal business write.
CREATE FUNCTION public.crm_test_track_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE row_json jsonb := to_jsonb(NEW); row_id text; refs jsonb; parent record;
 marker constant text := '【系统测试·勿联系】'; field text; value text; tracked boolean;
BEGIN
 row_id := coalesce(row_json->>'id',row_json->>'Id');
 IF row_id IS NULL THEN RAISE EXCEPTION 'Missing test tracking identity'; END IF;
 IF current_setting('crm.test_initial_batch',true) = 'crm_test_main_v1' THEN RETURN NEW; END IF;
 refs := public.crm_test_refs_v1(row_json,TG_TABLE_NAME);
 SELECT EXISTS(SELECT 1 FROM public.crm_test_records r WHERE r.record_table=TG_TABLE_NAME AND r.record_id=row_id) INTO tracked;
 IF NOT tracked AND NOT EXISTS(SELECT 1 FROM public.crm_test_records r JOIN jsonb_array_elements(refs) x ON r.record_table=x->>'table' AND r.record_id=x->>'id') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NOT tracked THEN
  RAISE EXCEPTION 'An existing ordinary row cannot become a test row' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME IN ('persons','customers') AND EXISTS (
  SELECT 1 FROM (VALUES ('phone'),('wechat'),('wx_account')) f(k) WHERE nullif(btrim(row_json->>f.k),'') IS NOT NULL
 ) THEN RAISE EXCEPTION 'Test records cannot contain contact addresses' USING ERRCODE='23514'; END IF;
 -- Guard mixed identities; a fictional relationship must not attach a real person/customer.
 IF NOT (TG_TABLE_NAME = ANY(ARRAY['ai_tasks','ai_runs','ai_results'])) AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(refs) x WHERE x->>'table' IN ('persons','customers') AND NOT EXISTS(
   SELECT 1 FROM public.crm_test_records r WHERE r.record_table=x->>'table' AND r.record_id=x->>'id')
 ) THEN RAISE EXCEPTION 'Mixed real/test identity is not allowed' USING ERRCODE='23514'; END IF;
 FOR field IN SELECT unnest(ARRAY['display_name','customer_name','person_name','name','title','task_title',
   'description','notes','note','summary','raw_note','followup_notes','interaction_summary','next_action',
   'next_followup_goal','last_progress','additional_info','content','context','situation','learning'])
 LOOP
  value := row_json->>field;
  IF value IS NOT NULL AND jsonb_typeof(row_json->field)='string' AND position(marker IN value)=0 THEN
   row_json := jsonb_set(row_json,ARRAY[field],to_jsonb(marker || value));
  END IF;
 END LOOP;
 IF TG_TABLE_NAME='persons' THEN row_json := jsonb_set(row_json,'{name_key}',to_jsonb(lower(row_json->>'display_name'))); END IF;
 NEW := jsonb_populate_record(NEW,row_json);
 FOR parent IN SELECT DISTINCT ON(r.batch_key) r.batch_key,r.record_table,r.record_id
   FROM public.crm_test_records r JOIN jsonb_array_elements(refs) x ON r.record_table=x->>'table' AND r.record_id=x->>'id'
   WHERE (r.record_table,r.record_id) IS DISTINCT FROM (TG_TABLE_NAME,row_id)
   ORDER BY r.batch_key,r.created_at,r.record_table,r.record_id
 LOOP
  INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,parent_table,parent_id,visible_label)
   VALUES(parent.batch_key,TG_TABLE_NAME,row_id,
    CASE WHEN TG_TABLE_NAME IN ('ai_tasks','ai_runs','ai_results') THEN 'ai_audit' ELSE 'derived' END,
    parent.record_table,parent.record_id,marker || '正常流程衍生记录')
   ON CONFLICT(batch_key,record_table,record_id) DO NOTHING;
 END LOOP;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_test_track_v1() FROM PUBLIC, anon, authenticated, service_role;

DO $block$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['actions','activities','activity_participants','activity_speakers','activity_tasks','activity_topics',
 'ai_recommendations','ai_results','ai_runs','ai_tasks','assistant_action_commands','commitments','context_items','customers',
 'followups','gifts','household_members','households','interactions','knowledge_items','learnings','ocr_records','opportunities',
 'opportunity_candidates','outcomes','person_roles','persons','photos','playbooks','policy_review_reports','products',
 'recruit_candidates','recruit_followups','recruit_goal_benchmarks','recruit_goals','recruit_milestones','relationships']
 LOOP
  EXECUTE format('CREATE TRIGGER zz_crm_test_track BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.crm_test_track_v1()',t);
 END LOOP;
END $block$;

CREATE FUNCTION public.crm_test_scenario_v1(p_stage text,p_actor_uid text,p_preview_id uuid DEFAULT NULL,p_preview_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
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
 -- All entry targets are taken from the protected manifest, never supplied by a browser.
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
 IF EXISTS(SELECT 1 FROM public.persons p WHERE p.name_key=lower(person_name) AND p.id::text IS DISTINCT FROM targets->>'person')
   OR EXISTS(SELECT 1 FROM public.customers c WHERE c.customer_name=person_name AND c."Id"::text IS DISTINCT FROM targets->>'customer') THEN
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
  -- No business, batch or registry writes in dry-run; only an expiring confirmation receipt.
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
  INSERT INTO public.customers(customer_name,source,additional_info,next_action,next_action_date,first_contact_date)
   VALUES(person_name,batch,marker||'纯虚构，无联系方式，无保单',marker||'核对测试场景',today,today-2) RETURNING "Id" INTO customer_id;
  INSERT INTO public.persons(display_name,name_key,source,notes,legacy_customer_id)
   VALUES(person_name,lower(person_name),batch,marker||'纯虚构身份',customer_id) RETURNING id INTO person_id;
  INSERT INTO public.person_roles(person_id,role,origin) VALUES(person_id,'customer','manual') RETURNING id INTO role_customer;
  INSERT INTO public.person_roles(person_id,role,origin) VALUES(person_id,'participant','manual') RETURNING id INTO role_participant;
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
END $fn$;
REVOKE ALL ON FUNCTION public.crm_test_scenario_v1(text,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_test_scenario_v1(text,text,uuid,text) TO service_role;

-- Search learns the matched identities AFTER parsing. Attach its existing audit chain.
CREATE FUNCTION public.crm_test_link_ai_v1(p_task_id bigint,p_refs jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE parent record; run_row record; result_row record; linked integer:=0;
BEGIN
 IF p_refs IS NULL OR jsonb_typeof(p_refs)<>'array' OR jsonb_array_length(p_refs)>2000 THEN
  RAISE EXCEPTION 'Invalid audit provenance' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.ai_tasks WHERE id=p_task_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown AI task' USING ERRCODE='23503'; END IF;
 FOR parent IN SELECT DISTINCT ON(r.batch_key) r.batch_key,r.record_table,r.record_id
   FROM public.crm_test_records r JOIN jsonb_array_elements(p_refs) x ON r.record_table=x->>'table' AND r.record_id=x->>'id'
   WHERE r.record_table NOT IN ('ai_tasks','ai_runs','ai_results') ORDER BY r.batch_key,r.created_at,r.record_table,r.record_id
 LOOP
  INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,parent_table,parent_id,visible_label)
   VALUES(parent.batch_key,'ai_tasks',p_task_id::text,'ai_audit',parent.record_table,parent.record_id,'【系统测试·勿联系】查询命中样本')
   ON CONFLICT DO NOTHING;
  FOR run_row IN SELECT id FROM public.ai_runs WHERE task_id=p_task_id LOOP
   INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,parent_table,parent_id,visible_label)
    VALUES(parent.batch_key,'ai_runs',run_row.id::text,'ai_audit','ai_tasks',p_task_id::text,'【系统测试·勿联系】模型运行') ON CONFLICT DO NOTHING;
  END LOOP;
  FOR result_row IN SELECT id,run_id FROM public.ai_results WHERE task_id=p_task_id LOOP
   INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,parent_table,parent_id,visible_label)
    VALUES(parent.batch_key,'ai_results',result_row.id::text,'ai_audit','ai_runs',result_row.run_id::text,'【系统测试·勿联系】模型结果') ON CONFLICT DO NOTHING;
  END LOOP;
  linked:=linked+1;
 END LOOP;
 IF linked>0 THEN
  UPDATE public.ai_tasks SET context_snapshot=coalesce(context_snapshot,'{}')||jsonb_build_object('_testSearch',
   jsonb_build_object('marker','【系统测试·勿联系】','notice','含测试数据','sources',p_refs)) WHERE id=p_task_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'linkedBatches',linked);
END $fn$;
REVOKE ALL ON FUNCTION public.crm_test_link_ai_v1(bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_test_link_ai_v1(bigint,jsonb) TO service_role;
COMMIT;
