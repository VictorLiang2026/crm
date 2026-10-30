-- Execute as service_role. Synthetic writes always roll back in the exception block.
DO $test$
DECLARE p bigint:=90000000000501; c integer:=1900000501; iid bigint; r jsonb; snap jsonb; draft jsonb;
BEGIN
 BEGIN
  IF EXISTS(SELECT 1 FROM public.persons WHERE id=p) OR EXISTS(SELECT 1 FROM public.customers WHERE "Id"=c)
    THEN RAISE EXCEPTION 'SYNTHETIC_ID_IN_USE'; END IF;
  INSERT INTO public.persons(id,display_name,name_key) OVERRIDING SYSTEM VALUE
    VALUES(p,'【系统测试·勿联系】互动迁移事务测试','【系统测试·勿联系】互动迁移事务测试');
  INSERT INTO public.customers("Id",person_id) OVERRIDING SYSTEM VALUE VALUES(c,p);
  draft=jsonb_build_object('requestKey','0af74c42-d45a-42d4-b6b2-8b2c6d6431dc','customer_id',c,
    'interaction_type','call','interaction_at','2026-10-30T02:03:04Z','time_precision','instant',
    'summary','【系统测试·勿联系】合成摘要','raw_note','【系统测试·勿联系】合成原文','channel','phone',
    'next_followup_date','2026-11-01','next_followup_goal','【系统测试·勿联系】合成计划');
  r=public.crm_person_interaction_v1('save','unified-interaction-test',p,draft); iid=(r#>>'{interaction,id}')::bigint;
  IF iid IS NULL THEN RAISE EXCEPTION 'SAVE_FAILED'; END IF;
  r=public.crm_person_interaction_v1('save','unified-interaction-test',p,draft);
  IF (r#>>'{interaction,id}')::bigint<>iid OR r->>'replayed'<>'true' THEN RAISE EXCEPTION 'RETRY_DUPLICATED'; END IF;
  UPDATE public.followups SET followup_notes='【系统测试·勿联系】旧入口修改' WHERE interaction_id=iid;
  IF (SELECT raw_note FROM public.interactions WHERE id=iid)<>'【系统测试·勿联系】旧入口修改' THEN RAISE EXCEPTION 'LEGACY_SYNC_FAILED'; END IF;
  snap=public.crm_person_interaction_v1('get','unified-interaction-test',p,jsonb_build_object('id',iid));
  BEGIN
   PERFORM public.crm_person_interaction_v1('save','unified-interaction-test',p,draft||jsonb_build_object('id',iid,'version','stale'));
   RAISE EXCEPTION 'STALE_WAS_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INTERACTION_STALE' THEN RAISE; END IF; END;
  r=public.crm_person_interaction_v1('save','unified-interaction-test',p,draft||jsonb_build_object('id',iid,'version',snap->>'version','summary','【系统测试·勿联系】新入口修改'));
  IF (SELECT interaction_summary FROM public.followups WHERE interaction_id=iid)<>'【系统测试·勿联系】新入口修改' THEN RAISE EXCEPTION 'CANONICAL_SYNC_FAILED'; END IF;
  UPDATE public.followups SET deleted_at='2026-10-30T03:00:00Z' WHERE interaction_id=iid;
  IF (SELECT deleted_at FROM public.interactions WHERE id=iid) IS DISTINCT FROM '2026-10-30T03:00:00Z'::timestamptz THEN RAISE EXCEPTION 'SOFT_DELETE_FAILED'; END IF;
  UPDATE public.followups SET deleted_at=NULL WHERE interaction_id=iid;
  snap=public.crm_person_interaction_v1('get','unified-interaction-test',p,jsonb_build_object('id',iid));
  r=public.crm_person_interaction_v1('remove','unified-interaction-test',p,jsonb_build_object('id',iid,'version',snap->>'version'));
  IF EXISTS(SELECT 1 FROM public.followups WHERE interaction_id=iid) OR NOT EXISTS(SELECT 1 FROM public.interactions WHERE id=iid AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'HARD_DELETE_RETENTION_FAILED'; END IF;
  RAISE EXCEPTION 'UNIFIED_TEST_ROLLBACK_OK';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'UNIFIED_TEST_ROLLBACK_OK' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.persons WHERE id=p) OR EXISTS(SELECT 1 FROM public.customers WHERE "Id"=c) THEN RAISE EXCEPTION 'SYNTHETIC_ROLLBACK_FAILED'; END IF;
END $test$;
