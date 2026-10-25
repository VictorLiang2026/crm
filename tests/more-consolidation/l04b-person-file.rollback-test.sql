-- Dedicated fictional records, rolled back through an internal subtransaction.
DO $test$
DECLARE actor text:='l04b-rollback-test'; pid bigint:=9000000000000405; j uuid; token uuid;
 saved jsonb; claimed jsonb; identity jsonb; pv jsonb; applied jsonb; undo jsonb; other jsonb; newpid bigint;
 request jsonb; rejected boolean; original_jobs bigint; original_commands bigint;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Test must run as service_role'; END IF;
 IF EXISTS(SELECT 1 FROM public.persons WHERE id=pid) THEN RAISE EXCEPTION 'Synthetic ID collision'; END IF;
 SELECT count(*) INTO original_jobs FROM public.crm_file_import_jobs;
 SELECT count(*) INTO original_commands FROM public.crm_person_file_commands;
 BEGIN
  INSERT INTO public.persons(id,display_name,name_key,phone,occupation) VALUES(pid,'【系统测试·勿联系】L04b甲','l04b_rollback_test','old-phone','untouched');
  request:=jsonb_build_object('fileName','fictional.txt','contentType','text/plain','base64','dGVzdA==','payloadHash',repeat('a',64),'idempotencyKey',gen_random_uuid());
  saved:=public.crm_person_file_v1(actor,'save',request);j:=(saved->'job'->>'id')::uuid;
  IF saved<>public.crm_person_file_v1(actor,'save',request) OR saved->'job' ? 'original_data' THEN RAISE EXCEPTION 'Save idempotency/projection failed'; END IF;
  rejected:=false;BEGIN
   PERFORM public.crm_person_file_v1('other-actor','get',jsonb_build_object('jobId',j));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid person file job';END;
  IF NOT rejected THEN RAISE EXCEPTION 'Foreign original leaked'; END IF;
  claimed:=public.crm_person_file_v1(actor,'claim',jsonb_build_object('jobId',j));token:=(claimed->>'leaseToken')::uuid;
  IF public.crm_person_file_v1(actor,'claim',jsonb_build_object('jobId',j)) ? 'leaseToken' THEN RAISE EXCEPTION 'Lease not exclusive'; END IF;
  PERFORM public.crm_person_file_v1(actor,'fail',jsonb_build_object('jobId',j,'leaseToken',token,'errorCode','PDF_ENCRYPTED'));
  claimed:=public.crm_person_file_v1(actor,'claim',jsonb_build_object('jobId',j));
  rejected:=false;BEGIN
   PERFORM public.crm_person_file_v1(actor,'complete',jsonb_build_object('jobId',j,'leaseToken',token,'fields','{}'::jsonb,'rawText','test'));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid person file lease';END;
  IF NOT rejected THEN RAISE EXCEPTION 'Stale lease accepted'; END IF;
  token:=(claimed->>'leaseToken')::uuid;
  PERFORM public.crm_person_file_v1(actor,'complete',jsonb_build_object('jobId',j,'leaseToken',token,'fields',jsonb_build_object('phone','new-phone'),'rawText','fictional text'));
  IF (SELECT phone FROM public.persons WHERE id=pid)<>'old-phone' THEN RAISE EXCEPTION 'Draft auto-applied'; END IF;
  identity:=public.person_identity_preview_v1(actor,gen_random_uuid(),'person',jsonb_build_object('display_name','【系统测试·勿联系】L04b甲',
   'name_key','l04b_rollback_test','person_id',pid,'occupation','','organization','','education','','source','人工新增'));
  request:=jsonb_build_object('jobId',j,'idempotencyKey',gen_random_uuid(),'identityPreviewId',identity->>'previewId','fields',jsonb_build_object('phone','new-phone'));
  pv:=public.crm_person_file_v1(actor,'preview',request);
  IF (pv->'preview'->'before'->>'phone')<>'old-phone' OR (pv->'preview'->'after'->>'phone')<>'new-phone' THEN RAISE EXCEPTION 'Preview diff incorrect'; END IF;
  IF public.crm_person_file_v1(actor,'preview',request)->>'previewId'<>pv->>'previewId' THEN RAISE EXCEPTION 'Preview retry duplicated'; END IF;
  rejected:=false;BEGIN
   PERFORM public.crm_person_file_v1(actor,'preview',request||jsonb_build_object('idempotencyKey',gen_random_uuid(),'fields',jsonb_build_object('deleted_at','2026-01-01')));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid person file selected fields';END;
  IF NOT rejected THEN RAISE EXCEPTION 'Protected field accepted'; END IF;
  rejected:=false;BEGIN
   UPDATE public.persons SET updated_at=clock_timestamp() WHERE id=pid;
   PERFORM public.crm_person_file_v1(actor,'execute',jsonb_build_object('previewId',pv->>'previewId'));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Identity candidates changed%';END;
  IF NOT rejected THEN RAISE EXCEPTION 'Stale Person accepted'; END IF;
  rejected:=false;BEGIN
   UPDATE public.crm_person_file_commands SET expires_at=clock_timestamp()-interval '1 second' WHERE id=(pv->>'previewId')::uuid;
   PERFORM public.crm_person_file_v1(actor,'execute',jsonb_build_object('previewId',pv->>'previewId'));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid person file preview expired or changed';END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expired preview accepted'; END IF;
  rejected:=false;BEGIN
   UPDATE public.crm_file_import_jobs SET updated_at=clock_timestamp() WHERE id=j;
   PERFORM public.crm_person_file_v1(actor,'execute',jsonb_build_object('previewId',pv->>'previewId'));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid person file preview expired or changed';END;
  IF NOT rejected THEN RAISE EXCEPTION 'Stale original job accepted'; END IF;
  rejected:=false;BEGIN
   PERFORM public.crm_person_file_v1('other-actor','execute',jsonb_build_object('previewId',pv->>'previewId'));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid person file preview';END;
  IF NOT rejected THEN RAISE EXCEPTION 'Foreign preview accepted'; END IF;
  rejected:=false;BEGIN
   PERFORM public.person_identity_execute_v1(actor,(identity->>'previewId')::uuid);
   PERFORM public.crm_person_file_v1(actor,'execute',jsonb_build_object('previewId',pv->>'previewId'));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid person file identity changed';END;
  IF NOT rejected THEN RAISE EXCEPTION 'Out-of-band identity accepted'; END IF;
  applied:=public.crm_person_file_v1(actor,'execute',jsonb_build_object('previewId',pv->>'previewId'));
  IF applied->>'ok'<>'true' OR (SELECT phone FROM public.persons WHERE id=pid)<>'new-phone' OR
     (SELECT occupation FROM public.persons WHERE id=pid)<>'untouched' OR
     EXISTS(SELECT 1 FROM public.customers WHERE person_id=pid) OR EXISTS(SELECT 1 FROM public.person_roles WHERE person_id=pid) THEN
   RAISE EXCEPTION 'Apply scope failed'; END IF;
  other:=public.crm_person_file_v1(actor,'execute',jsonb_build_object('previewId',pv->>'previewId'));
  IF other->>'replayed'<>'true' THEN RAISE EXCEPTION 'Execute replay failed'; END IF;
  rejected:=false;BEGIN
   UPDATE public.persons SET updated_at=clock_timestamp(),phone='later-change' WHERE id=pid;
   PERFORM public.crm_person_file_v1(actor,'undo_preview',jsonb_build_object('jobId',j,'commandId',applied->>'commandId','idempotencyKey',gen_random_uuid()));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid person file undo conflict';END;
  IF NOT rejected THEN RAISE EXCEPTION 'Undo conflict accepted'; END IF;
  undo:=public.crm_person_file_v1(actor,'undo_preview',jsonb_build_object('jobId',j,'commandId',applied->>'commandId','idempotencyKey',gen_random_uuid()));
  rejected:=false;BEGIN
   UPDATE public.persons SET updated_at=clock_timestamp(),phone='change-after-undo-preview' WHERE id=pid;
   PERFORM public.crm_person_file_v1(actor,'execute',jsonb_build_object('previewId',undo->>'previewId'));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid person file undo conflict';END;
  IF NOT rejected THEN RAISE EXCEPTION 'Stale undo preview accepted'; END IF;
  PERFORM public.crm_person_file_v1(actor,'execute',jsonb_build_object('previewId',undo->>'previewId'));
  IF (SELECT phone FROM public.persons WHERE id=pid)<>'old-phone' OR
     (SELECT person_id FROM public.crm_file_import_jobs WHERE id=j) IS NOT NULL THEN RAISE EXCEPTION 'Undo failed'; END IF;
  -- Reassociate to a newly confirmed Person, never create a Customer.
  identity:=public.person_identity_preview_v1(actor,gen_random_uuid(),'person',jsonb_build_object('display_name','【系统测试·勿联系】L04b新建',
   'name_key','l04b_rollback_new','occupation','','organization','','education','','source','人工新增'));
  pv:=public.crm_person_file_v1(actor,'preview',jsonb_build_object('jobId',j,'idempotencyKey',gen_random_uuid(),
   'identityPreviewId',identity->>'previewId','fields',jsonb_build_object('source','reviewed-source')));
  applied:=public.crm_person_file_v1(actor,'execute',jsonb_build_object('previewId',pv->>'previewId'));newpid:=(applied->>'personId')::bigint;
  IF newpid IS NULL OR newpid=pid OR EXISTS(SELECT 1 FROM public.customers WHERE person_id=newpid) THEN RAISE EXCEPTION 'New Person scope failed'; END IF;
  undo:=public.crm_person_file_v1(actor,'undo_preview',jsonb_build_object('jobId',j,'commandId',applied->>'commandId','idempotencyKey',gen_random_uuid()));
  PERFORM public.crm_person_file_v1(actor,'execute',jsonb_build_object('previewId',undo->>'previewId'));
  IF NOT EXISTS(SELECT 1 FROM public.persons WHERE id=newpid AND deleted_at IS NULL AND source='人工新增') THEN RAISE EXCEPTION 'New Person undo lost identity/default source'; END IF;
  identity:=public.person_identity_preview_v1(actor,gen_random_uuid(),'person',jsonb_build_object('display_name','【系统测试·勿联系】L04b甲',
   'name_key','l04b_rollback_test','person_id',pid,'occupation','','organization','','education','','source','人工新增'));
  pv:=public.crm_person_file_v1(actor,'preview',jsonb_build_object('jobId',j,'idempotencyKey',gen_random_uuid(),
   'identityPreviewId',identity->>'previewId','fields','{}'::jsonb));
  applied:=public.crm_person_file_v1(actor,'execute',jsonb_build_object('previewId',pv->>'previewId'));
  other:=public.crm_person_file_v1(actor,'list',jsonb_build_object('personId',pid,'page',1));
  IF jsonb_array_length(other->'rows')<>1 OR (SELECT phone FROM public.persons WHERE id=pid)<>'old-phone' THEN RAISE EXCEPTION 'Link-only scope failed'; END IF;
  other:=public.crm_file_import_v1(actor,'list',jsonb_build_object('personId',pid::text,'page',1));
  IF jsonb_array_length(other->'rows')<>0 THEN RAISE EXCEPTION 'Standalone job leaked into old customer list'; END IF;
  other:=public.crm_person_file_v1(actor,'list',jsonb_build_object('page',1));
  IF jsonb_array_length(other->'rows')<>1 OR other->'rows'->0 ? 'original_data' OR other->'rows'->0 ? 'raw_text' OR other->'rows'->0 ? 'lease_token' THEN RAISE EXCEPTION 'List leaked payload'; END IF;
  rejected:=false;BEGIN
   UPDATE public.crm_file_import_jobs SET original_data='data:text/plain;base64,YQ==' WHERE id=j;
   PERFORM public.crm_person_file_v1(actor,'get',jsonb_build_object('jobId',j));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid person file source';END;
  IF NOT rejected THEN RAISE EXCEPTION 'Changed source accepted'; END IF;
  RAISE EXCEPTION USING ERRCODE='ZX045',MESSAGE='Rollback all L04b fictional records';
 EXCEPTION WHEN SQLSTATE 'ZX045' THEN NULL;
 END;
 IF (SELECT count(*) FROM public.crm_file_import_jobs)<>original_jobs OR
    (SELECT count(*) FROM public.crm_person_file_commands)<>original_commands OR
    EXISTS(SELECT 1 FROM public.persons WHERE id=pid OR name_key='l04b_rollback_new') THEN RAISE EXCEPTION 'Fictional data did not roll back'; END IF;
END $test$;

