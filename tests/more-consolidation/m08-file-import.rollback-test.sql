-- Execute with service_role. Every fictional row rolls back inside the exception subtransaction.
-- Sequence allocation may leave harmless gaps; no real customer row is changed.
DO $test$
DECLARE person_key bigint:=9000000000000808; customer_key integer:=2147482808;
 actor text:='m08-rollback-test'; d jsonb; a jsonb; b jsonb; claim jsonb; result jsonb;
 job uuid; token uuid; photo integer; ocr bigint; rejected boolean; before_jobs bigint;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Test must run as service_role'; END IF;
 SELECT count(*) INTO before_jobs FROM public.crm_file_import_jobs;
 IF EXISTS(SELECT 1 FROM public.persons WHERE id=person_key) OR EXISTS(SELECT 1 FROM public.customers WHERE "Id"=customer_key) OR
    EXISTS(SELECT 1 FROM public.crm_test_batches WHERE batch_key='crm_test_m08_rollback') THEN RAISE EXCEPTION 'Synthetic ID collision'; END IF;
 BEGIN
   INSERT INTO public.persons(id,display_name,name_key) VALUES(person_key,'【系统测试·勿联系】M08回滚甲','m08_rollback_test');
   INSERT INTO public.customers("Id",person_id) VALUES(customer_key,person_key);
   d:=jsonb_build_object('personId',person_key::text,'customerId',customer_key::text,'idempotencyKey',gen_random_uuid(),
      'fileName','m08-test.txt','contentType','text/plain','base64','dGVzdA==','payloadHash',repeat('a',64),'notes','');
   a:=public.crm_file_import_v1(actor,'save',d);job:=(a->'job'->>'id')::uuid;photo:=(a->'job'->>'photo_id')::integer;
   b:=public.crm_file_import_v1(actor,'save',d);
   IF a<>b OR (SELECT count(*) FROM public.photos WHERE customer_id=customer_key)<>1 THEN RAISE EXCEPTION 'Save idempotency failed'; END IF;
   rejected:=false;BEGIN
     PERFORM public.crm_file_import_v1(actor,'save',d||jsonb_build_object('payloadHash',repeat('b',64)));
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Idempotency key%';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Conflicting key accepted'; END IF;
   rejected:=false;BEGIN
     PERFORM public.crm_file_import_v1('different-actor','claim',jsonb_build_object('jobId',job));
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid file import job';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Actor isolation failed'; END IF;
   claim:=public.crm_file_import_v1(actor,'claim',jsonb_build_object('jobId',job));token:=(claim->>'leaseToken')::uuid;
   b:=public.crm_file_import_v1(actor,'claim',jsonb_build_object('jobId',job));
   IF token IS NULL OR b ? 'leaseToken' OR b ? 'source' THEN RAISE EXCEPTION 'Active lease not exclusive'; END IF;
   PERFORM public.crm_file_import_v1(actor,'fail',jsonb_build_object('jobId',job,'leaseToken',token,'errorCode','PARSE_FAILED'));
   IF NOT EXISTS(SELECT 1 FROM public.photos WHERE id=photo) THEN RAISE EXCEPTION 'Failure removed original'; END IF;
   claim:=public.crm_file_import_v1(actor,'claim',jsonb_build_object('jobId',job));
   rejected:=false;BEGIN
     PERFORM public.crm_file_import_v1(actor,'complete',jsonb_build_object('jobId',job,'leaseToken',token,'fields','{}'::jsonb,'rawText','test'));
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid file import lease';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Stale worker accepted'; END IF;
   token:=(claim->>'leaseToken')::uuid;
   UPDATE public.crm_file_import_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=job;
   claim:=public.crm_file_import_v1(actor,'claim',jsonb_build_object('jobId',job));
   IF token=(claim->>'leaseToken')::uuid OR (claim->'job'->>'attempts')::integer<>3 THEN RAISE EXCEPTION 'Expired lease not reclaimed'; END IF;
   token:=(claim->>'leaseToken')::uuid;
   rejected:=false;BEGIN
     PERFORM public.crm_file_import_v1(actor,'complete',jsonb_build_object('jobId',job,'leaseToken',token,
       'fields',jsonb_build_object('deleted_at','2026-01-01'),'rawText','test'));
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid file import field';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Out-of-scope fields accepted'; END IF;
   result:=public.crm_file_import_v1(actor,'complete',jsonb_build_object('jobId',job,'leaseToken',token,
      'fields',jsonb_build_object('occupation','fictional'),'rawText','test'));
   ocr:=(result->'job'->>'ocr_record_id')::bigint;
   PERFORM public.crm_file_import_v1(actor,'complete',jsonb_build_object('jobId',job,'leaseToken',token,'fields','{}'::jsonb,'rawText','retry'));
   IF (SELECT count(*) FROM public.ocr_records WHERE customer_id=customer_key)<>1 OR ocr IS NULL THEN RAISE EXCEPTION 'Draft duplicated'; END IF;
   IF (SELECT occupation FROM public.persons WHERE id=person_key) IS NOT NULL THEN RAISE EXCEPTION 'Person auto-mutated'; END IF;
   result:=public.crm_file_import_v1(actor,'list',jsonb_build_object('personId',person_key::text,'page',1));
   IF jsonb_array_length(result->'rows')<>1 OR result->'rows'->0 ? 'lease_token' OR result->'rows'->0 ? 'actor_uid' THEN RAISE EXCEPTION 'List projection failed'; END IF;
   b:=public.crm_file_import_v1('different-actor','list',jsonb_build_object('personId',person_key::text));
   IF jsonb_array_length(b->'rows')<>0 THEN RAISE EXCEPTION 'List actor isolation failed'; END IF;
   UPDATE public.photos SET photo_url='data:text/plain;base64,YQ==' WHERE id=photo;
   rejected:=false;BEGIN
     PERFORM public.crm_file_import_v1(actor,'claim',jsonb_build_object('jobId',job));
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Invalid file import source%';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Changed source accepted'; END IF;
   INSERT INTO public.crm_test_batches(batch_key,created_by_uid) VALUES('crm_test_m08_rollback',actor);
   rejected:=false;BEGIN
     PERFORM public.crm_file_import_v1(actor,'list',jsonb_build_object('personId',person_key::text));
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Test account requires%';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Test identity guard failed'; END IF;
   RAISE EXCEPTION USING ERRCODE='ZX008',MESSAGE='M08 rollback all fictional rows';
 EXCEPTION WHEN SQLSTATE 'ZX008' THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM public.persons WHERE id=person_key) OR EXISTS(SELECT 1 FROM public.customers WHERE "Id"=customer_key) OR
    EXISTS(SELECT 1 FROM public.photos WHERE customer_id=customer_key) OR EXISTS(SELECT 1 FROM public.ocr_records WHERE customer_id=customer_key) OR
    EXISTS(SELECT 1 FROM public.crm_test_batches WHERE batch_key='crm_test_m08_rollback') OR
    (SELECT count(*) FROM public.crm_file_import_jobs)<>before_jobs THEN RAISE EXCEPTION 'Test rollback failed'; END IF;
END $test$;
