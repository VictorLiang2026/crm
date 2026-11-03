-- One atomic DO statement with a synthetic row; a sentinel exception rolls back the inner subtransaction on success.
DO $test$
DECLARE r jsonb; stale_at timestamptz; v int;
BEGIN
 BEGIN
 EXECUTE 'SET LOCAL ROLE service_role';
 IF EXISTS(SELECT 1 FROM public.knowledge_items WHERE id=90000000000313) THEN RAISE EXCEPTION 'SYNTHETIC_ID_ALREADY_EXISTS'; END IF;
 INSERT INTO public.knowledge_items(id,item_type,source,content,metadata,confidence,lifecycle_status,verified,verified_by,created_by,updated_by)
 VALUES(90000000000313,'evidence','Direct-save synthetic - do not use','System original',
   '{"summary":"System summary"}',0.9,'verified',true,'direct-save-test','direct-save-test','direct-save-test');
 r=public.crm_knowledge_content_v1('get','direct-save-test','{"table":"knowledge_items","id":90000000000313}');
 stale_at=(r#>>'{record,updatedAt}')::timestamptz; v=(r#>>'{record,version}')::int;
 r=public.crm_knowledge_content_v1('save','direct-save-test',jsonb_build_object('table','knowledge_items','id',90000000000313,
   'expectedUpdatedAt',stale_at,'expectedVersion',v,'expectedSourceFingerprint',NULL,'target','gpt','patch',jsonb_build_object('summary','GPT summary')));
 IF r#>>'{record,gpt,summary}'<>'GPT summary' OR r#>>'{record,original,text}'<>'System original' OR r#>>'{record,original,summary}'<>'System summary'
   THEN RAISE EXCEPTION 'DIRECT_GPT_SAVE_CHANGED_WRONG_FIELDS'; END IF;
 IF r#>>'{record,gpt,reviewed}'<>'true' OR r#>>'{record,paused}'<>'false' THEN RAISE EXCEPTION 'DIRECT_GPT_SAVE_NOT_ACTIVE'; END IF;
 BEGIN
  PERFORM public.crm_knowledge_content_v1('save','direct-save-test',jsonb_build_object('table','knowledge_items','id',90000000000313,
   'expectedUpdatedAt',stale_at,'expectedVersion',v,'expectedSourceFingerprint',NULL,'target','gpt','patch',jsonb_build_object('summary','Stale overwrite')));
  RAISE EXCEPTION 'STALE_SAVE_WAS_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'CONTENT_STALE' THEN RAISE; END IF; END;
 v=(r#>>'{record,version}')::int;
 r=public.crm_knowledge_content_v1('save','direct-save-test',jsonb_build_object('table','knowledge_items','id',90000000000313,
   'expectedUpdatedAt',r#>>'{record,updatedAt}','expectedVersion',v,'expectedSourceFingerprint',NULL,'target','original',
   'patch',jsonb_build_object('text',NULL,'summary',NULL)));
 IF r#>>'{record,original,text}' IS NOT NULL OR r#>>'{record,original,summary}' IS NOT NULL OR r#>>'{record,paused}'<>'true'
   THEN RAISE EXCEPTION 'CLEAR_SYSTEM_PAIR_DID_NOT_APPLY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.knowledge_items WHERE id=90000000000313 AND length(btrim(content))>0)
   THEN RAISE EXCEPTION 'LEGACY_REQUIRED_TEXT_COLUMN_WAS_BROKEN'; END IF;
 IF EXISTS(SELECT 1 FROM public.knowledge_content_commands WHERE record_table='knowledge_items' AND record_id=90000000000313)
   THEN RAISE EXCEPTION 'DIRECT_SAVE_CREATED_HISTORY_COMMAND'; END IF;
 RAISE EXCEPTION 'DIRECT_SAVE_TEST_ROLLBACK';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'DIRECT_SAVE_TEST_ROLLBACK' THEN RAISE; END IF; END;
END;
$test$;
