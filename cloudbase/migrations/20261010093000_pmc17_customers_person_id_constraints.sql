-- PMC-17 指令④ migration B：customers.person_id SET NOT NULL + recruit 活跃行部分唯一索引 + 两 DB 函数适配 person_id 直写
-- 范围（用户 2026-10-10 批准"customers.person_id 三重约束 + recruit 部分唯一索引"）：
--   1. person_identity_execute_v1：客户分支 INSERT customers 直写 person_id=v_person.id（消除先 NULL 后 UPDATE 的窗口；函数其余部分逐字保持 20261004011800 原定义）
--   2. crm_test_scenario_v1：种子调序（先 persons 无 legacy_customer_id → 两行 manual 角色原位 → customers 带 person_id → 回写 legacy_customer_id；函数其余部分逐字保持 20261003005000 原定义）
--   3. customers.person_id SET NOT NULL。注意：UNIQUE（customers_person_id_key）与 FK（customers_person_id_fkey → persons(id) ON DELETE RESTRICT）
--      自 PMC-05 migration 20261008120000 起已在效（D1 设计即"回填完成后置 NOT NULL"），本 migration 落实最后的 NOT NULL。
--   4. recruit_candidates(person_id) 活跃行部分唯一索引（WHERE deleted_at IS NULL；软删行允许重复——基准：含软删重复 1 组、活跃重复 0）
-- 通道说明：经 tools/tcb-exec.cjs 执行（网关一文件一首条语句），全部 DDL/DCL 置于单条 DO 块内，任一断言失败 RAISE 即整体回滚。
-- 回滚：cloudbase/rollbacks/20261010093000_pmc17_customers_person_id_constraints.rollback.sql
DO $pmc17b$
BEGIN
 -- ── 守卫断言（2026-10-10 实时复核基准：customers NULL=0/重复组=0/孤儿=0，活跃 782/软删 1；recruit 活跃重复=0，活跃 15/软删 3）──
 IF EXISTS(SELECT 1 FROM public.customers WHERE person_id IS NULL) THEN
  RAISE EXCEPTION 'PMC-17-B guard: customers.person_id NULL rows remain'; END IF;
 IF EXISTS(SELECT person_id FROM public.customers GROUP BY person_id HAVING count(*)>1 LIMIT 1) THEN
  RAISE EXCEPTION 'PMC-17-B guard: duplicate customers.person_id groups remain'; END IF;
 IF EXISTS(SELECT 1 FROM public.customers c LEFT JOIN public.persons p ON p.id=c.person_id WHERE p.id IS NULL) THEN
  RAISE EXCEPTION 'PMC-17-B guard: orphan customers.person_id remain'; END IF;
 IF EXISTS(SELECT person_id FROM public.recruit_candidates WHERE deleted_at IS NULL AND person_id IS NOT NULL GROUP BY person_id HAVING count(*)>1 LIMIT 1) THEN
  RAISE EXCEPTION 'PMC-17-B guard: active recruit_candidates duplicate person_id groups remain'; END IF;

 -- ── (1) person_identity_execute_v1：唯一改动=customers INSERT 列清单加 person_id、VALUES 加 v_person.id ──
 EXECUTE $migrate_exec$
CREATE OR REPLACE FUNCTION public.person_identity_execute_v1(p_actor_uid text,p_preview_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $execute$
DECLARE v_cmd public.person_identity_commands%ROWTYPE;v_person public.persons%ROWTYPE;
  v_name_key text;v_fingerprint text;v_customer_id bigint;v_recruit_id bigint;
  v_speaker_id bigint;v_interaction_id bigint;v_result jsonb;v_parent_id text;
BEGIN
  IF current_user<>'service_role' OR nullif(btrim(p_actor_uid),'') IS NULL THEN
    RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cmd FROM public.person_identity_commands
    WHERE id=p_preview_id AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Preview not found for this account'; END IF;
  IF v_cmd.status='executed' THEN RETURN v_cmd.result; END IF;
  IF v_cmd.expires_at<=now() THEN RAISE EXCEPTION 'Preview expired'; END IF;
  v_name_key:=v_cmd.payload->>'name_key';
  PERFORM pg_advisory_xact_lock(hashtextextended(v_name_key,0));
  SELECT md5(coalesce(string_agg(id::text||':'||updated_at::text,',' ORDER BY id),''))
    INTO v_fingerprint FROM public.persons WHERE name_key=v_name_key AND deleted_at IS NULL;
  IF v_fingerprint<>v_cmd.candidate_fingerprint THEN
    RAISE EXCEPTION 'Identity candidates changed; preview again'; END IF;
  IF v_cmd.payload ? 'person_id' AND nullif(v_cmd.payload->>'person_id','') IS NOT NULL THEN
    SELECT * INTO v_person FROM public.persons
      WHERE id=(v_cmd.payload->>'person_id')::bigint AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_person.display_name<>v_cmd.payload->>'display_name'
       OR v_person.name_key<>v_name_key THEN
      RAISE EXCEPTION 'Selected Person changed; preview again'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.persons WHERE display_name=v_cmd.payload->>'display_name'
      AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Deleted identity requires manual review'; END IF;
    IF EXISTS (SELECT 1 FROM public.persons WHERE name_key=v_name_key AND deleted_at IS NULL)
       AND ((v_cmd.payload->>'display_name') !~ '(（[^（）]+）|\([^()]+\))$'
         OR EXISTS (SELECT 1 FROM public.persons WHERE display_name=v_cmd.payload->>'display_name'
            AND deleted_at IS NULL)) THEN
      RAISE EXCEPTION 'Same-name Person changed; preview again'; END IF;
    IF EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid)
       AND position('【系统测试·勿联系】' IN (v_cmd.payload->>'display_name'))=0 THEN
      RAISE EXCEPTION 'Test account must use fictional marked Person'; END IF;
    INSERT INTO public.persons(display_name,name_key,occupation,organization,education,source)
      VALUES(v_cmd.payload->>'display_name',v_name_key,
        nullif(v_cmd.payload->>'occupation',''),nullif(v_cmd.payload->>'organization',''),
        nullif(v_cmd.payload->>'education',''),
        coalesce(nullif(v_cmd.payload->>'source',''),'人工新增')) RETURNING * INTO v_person;
    IF EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) THEN
      SELECT record_id INTO v_parent_id FROM public.crm_test_records
        WHERE batch_key='crm_test_main_v1' AND record_table='persons'
        ORDER BY created_at LIMIT 1;
      IF v_parent_id IS NULL THEN RAISE EXCEPTION 'Test parent Person is missing'; END IF;
      INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,
        parent_table,parent_id,visible_label)
      VALUES('crm_test_main_v1','persons',v_person.id::text,'derived',
        'persons',v_parent_id,'【系统测试·勿联系】WP07.1 人工新增人物');
    END IF;
  END IF;
  v_customer_id:=v_person.legacy_customer_id;
  IF v_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers
    WHERE "Id"=v_customer_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Customer is in recycle bin; restore it first'; END IF;
  IF v_cmd.kind='customer' OR
     (v_cmd.kind='capture' AND coalesce((v_cmd.payload->>'customer')::boolean,false)) THEN
    IF v_customer_id IS NULL THEN
      IF EXISTS(SELECT 1 FROM public.customers
        WHERE customer_name=v_person.display_name) THEN
        RAISE EXCEPTION 'Customer name already exists; review customer ID manually'; END IF;
      INSERT INTO public.customers(customer_name,phone,wx_account,gender,birthday,
        occupation,education,source,person_id)
      VALUES(v_person.display_name,v_person.phone,v_person.wechat,v_person.gender,
        v_person.birthday,v_person.occupation,v_person.education,'Person 角色转换',
        v_person.id)
      RETURNING "Id" INTO v_customer_id;
      IF EXISTS(SELECT 1 FROM public.crm_test_records
        WHERE record_table='persons' AND record_id=v_person.id::text) THEN
        INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,
          parent_table,parent_id,visible_label)
        SELECT batch_key,'customers',v_customer_id::text,'derived','persons',
          v_person.id::text,'【系统测试·勿联系】WP07.1 转客户'
        FROM public.crm_test_records WHERE record_table='persons'
          AND record_id=v_person.id::text ON CONFLICT DO NOTHING;
      END IF;
      UPDATE public.persons SET legacy_customer_id=v_customer_id,updated_at=now()
        WHERE id=v_person.id;
      UPDATE public.recruit_candidates SET customer_id=v_customer_id,updated_at=now()
        WHERE person_id=v_person.id AND customer_id IS NULL AND deleted_at IS NULL;
    END IF;
    INSERT INTO public.person_roles(person_id,role,origin)
      VALUES(v_person.id,'customer','manual') ON CONFLICT(person_id,role) DO NOTHING;
  END IF;
  IF v_cmd.kind='recruit' THEN
    SELECT id INTO v_recruit_id FROM public.recruit_candidates
      WHERE person_id=v_person.id AND deleted_at IS NULL;
    IF v_recruit_id IS NULL THEN
      INSERT INTO public.recruit_candidates(person_id,customer_id,stage,stage_changed_at)
      VALUES(v_person.id,v_customer_id,'新增人才',now()) RETURNING id INTO v_recruit_id;
      INSERT INTO public.recruit_milestones(candidate_id,from_stage,to_stage,note)
        VALUES(v_recruit_id,NULL,'新增人才','人工转增员');
    END IF;
    INSERT INTO public.person_roles(person_id,role,origin)
      VALUES(v_person.id,'recruit','manual') ON CONFLICT(person_id,role) DO NOTHING;
  END IF;
  IF v_cmd.kind IN ('speaker','capture') THEN
    IF v_cmd.kind='speaker' OR coalesce((v_cmd.payload->>'speaker')::boolean,false) THEN
      IF v_cmd.payload ? 'speaker_id' THEN
        SELECT id INTO v_speaker_id FROM public.activity_speakers
          WHERE id=(v_cmd.payload->>'speaker_id')::bigint AND deleted_at IS NULL
            AND name=v_person.display_name AND customer_id IS NULL
            AND (person_id IS NULL OR person_id=v_person.id) FOR UPDATE;
        IF v_speaker_id IS NULL THEN RAISE EXCEPTION 'Speaker profile changed; preview again'; END IF;
        UPDATE public.activity_speakers SET person_id=v_person.id,customer_id=v_customer_id,
          updated_at=now() WHERE id=v_speaker_id AND person_id IS NULL;
        IF v_cmd.kind='capture' THEN
          UPDATE public.activity_speakers SET last_contact_date=current_date,
            last_contact_note='【快速记录】'||(v_cmd.payload->>'note'),
            next_contact_date=nullif(v_cmd.payload->>'next_contact_date','')::date,
            updated_at=now() WHERE id=v_speaker_id;
        END IF;
      ELSE
        SELECT id INTO v_speaker_id FROM public.activity_speakers
          WHERE person_id=v_person.id AND deleted_at IS NULL ORDER BY id LIMIT 1;
      END IF;
      IF v_speaker_id IS NULL THEN
        INSERT INTO public.activity_speakers(name,person_id,customer_id,source,
          last_contact_date,last_contact_note,next_contact_date)
          VALUES(v_person.display_name,v_person.id,v_customer_id,'快速记录',
            CASE WHEN v_cmd.kind='capture' THEN current_date ELSE NULL END,
            CASE WHEN v_cmd.kind='capture' THEN '【快速记录】'||(v_cmd.payload->>'note') ELSE NULL END,
            nullif(v_cmd.payload->>'next_contact_date','')::date)
          RETURNING id INTO v_speaker_id;
      END IF;
      INSERT INTO public.person_roles(person_id,role,origin)
        VALUES(v_person.id,'speaker','manual') ON CONFLICT(person_id,role) DO NOTHING;
    END IF;
  END IF;
  IF v_cmd.kind='capture' THEN
    IF length(btrim(coalesce(v_cmd.payload->>'note','')))=0
       OR length(v_cmd.payload->>'note')>10000 THEN
      RAISE EXCEPTION 'Invalid quick capture note'; END IF;
    INSERT INTO public.interactions(person_id,interaction_type,interaction_at,
      summary,raw_note,source_type,created_by_uid)
    VALUES(v_person.id,'交流',coalesce((v_cmd.payload->>'interaction_at')::timestamptz,now()),
      left(coalesce(nullif(v_cmd.payload->>'summary',''),v_cmd.payload->>'note'),2000),
      v_cmd.payload->>'note','manual',p_actor_uid) RETURNING id INTO v_interaction_id;
  END IF;
  v_result:=jsonb_build_object('personId',v_person.id,'customerId',v_customer_id,
    'recruitId',v_recruit_id,'speakerId',v_speaker_id,'interactionId',v_interaction_id,
    'replayed',false);
  UPDATE public.person_identity_commands SET status='executed',result=v_result,
    executed_at=now() WHERE id=v_cmd.id;
  RETURN v_result;
END $execute$;
$migrate_exec$;
 EXECUTE 'REVOKE ALL ON FUNCTION public.person_identity_execute_v1(text,uuid) FROM PUBLIC,anon,authenticated';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.person_identity_execute_v1(text,uuid) TO service_role';

 -- ── (2) crm_test_scenario_v1：种子调序（先 persons 无 legacy_customer_id → 两行 manual 角色原位 → customers 带 person_id → 回写 legacy_customer_id）──
 EXECUTE $migrate_scen$
CREATE OR REPLACE FUNCTION public.crm_test_scenario_v1(p_stage text,p_actor_uid text,p_preview_id uuid DEFAULT NULL,p_preview_hash text DEFAULT NULL)
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
  INSERT INTO public.persons(display_name,name_key,source,notes)
   VALUES(person_name,lower(person_name),batch,marker||'纯虚构身份') RETURNING id INTO person_id;
  INSERT INTO public.person_roles(person_id,role,origin) VALUES(person_id,'customer','manual') RETURNING id INTO role_customer;
  INSERT INTO public.person_roles(person_id,role,origin) VALUES(person_id,'participant','manual') RETURNING id INTO role_participant;
  INSERT INTO public.customers(customer_name,person_id,source,additional_info,next_action,next_action_date,first_contact_date)
   VALUES(person_name,person_id,batch,marker||'纯虚构，无联系方式，无保单',marker||'核对测试场景',today,today-2) RETURNING "Id" INTO customer_id;
  UPDATE public.persons SET legacy_customer_id=customer_id,updated_at=now() WHERE id=person_id;
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
$migrate_scen$;
 EXECUTE 'REVOKE ALL ON FUNCTION public.crm_test_scenario_v1(text,text,uuid,text) FROM PUBLIC, anon, authenticated';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.crm_test_scenario_v1(text,text,uuid,text) TO service_role';

 -- ── (3) customers.person_id SET NOT NULL（UNIQUE/FK 自 20261008120000 已在效）──
 EXECUTE 'ALTER TABLE public.customers ALTER COLUMN person_id SET NOT NULL';

 -- ── (4) recruit_candidates 活跃行 person_id 部分唯一索引（软删行允许重复）──
 EXECUTE 'CREATE UNIQUE INDEX recruit_candidates_person_id_active_key ON public.recruit_candidates(person_id) WHERE deleted_at IS NULL';
END $pmc17b$;
