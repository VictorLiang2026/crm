-- Service-role fictional rows only. All rows roll back; generated sequence values may leave gaps.
DO $test$
DECLARE p bigint:=9000000000000404; c integer:=2147482404; actor text:='l04a-rollback-test';
 saved jsonb; claimed jsonb; receipt jsonb; job uuid; photo integer; code text; rejected boolean;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Expected service_role'; END IF;
 IF EXISTS(SELECT 1 FROM public.persons WHERE id=p) OR EXISTS(SELECT 1 FROM public.customers WHERE "Id"=c)
 THEN RAISE EXCEPTION 'Fictional ID collision'; END IF;
 BEGIN
  INSERT INTO public.persons(id,display_name,name_key) VALUES(p,'【系统测试·勿联系】L04PDF','l04_pdf_rollback');
  INSERT INTO public.customers("Id",person_id) VALUES(c,p);
  saved:=public.crm_file_import_v1(actor,'save',jsonb_build_object('personId',p::text,'customerId',c::text,
   'idempotencyKey',gen_random_uuid(),'fileName','fictional.pdf','contentType','application/pdf','base64','JVBERi0=',
   'payloadHash',repeat('b',64)));
  job:=(saved->'job'->>'id')::uuid;photo:=(saved->'job'->>'photo_id')::integer;
  FOREACH code IN ARRAY ARRAY['PDF_ENCRYPTED','PDF_NO_TEXT','PDF_LIMIT','PDF_TIMEOUT'] LOOP
   claimed:=public.crm_file_import_v1(actor,'claim',jsonb_build_object('jobId',job));
   receipt:=public.crm_file_import_v1(actor,'fail',jsonb_build_object('jobId',job,'leaseToken',claimed->>'leaseToken','errorCode',code));
   IF receipt->'job'->>'error_code'<>code OR receipt->'job'->>'status'<>'failed' THEN RAISE EXCEPTION 'Wrong PDF receipt'; END IF;
   receipt:=public.crm_file_import_v1(actor,'list',jsonb_build_object('personId',p::text));
   IF receipt->'rows'->0->>'error_code'<>code THEN RAISE EXCEPTION 'PDF reason not persisted'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.photos WHERE id=photo AND photo_url='data:application/pdf;base64,JVBERi0=')
     OR EXISTS(SELECT 1 FROM public.ocr_records WHERE customer_id=c)
     OR (SELECT occupation FROM public.persons WHERE id=p) IS NOT NULL THEN RAISE EXCEPTION 'Failure changed original/business data'; END IF;
  END LOOP;
  claimed:=public.crm_file_import_v1(actor,'claim',jsonb_build_object('jobId',job));
  rejected:=false;
  BEGIN
   PERFORM public.crm_file_import_v1(actor,'fail',jsonb_build_object('jobId',job,'leaseToken',claimed->>'leaseToken','errorCode','UNTRUSTED_DETAIL'));
  EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid file import error code'; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unbounded error accepted'; END IF;
  RAISE EXCEPTION USING ERRCODE='ZX404',MESSAGE='Roll back fictional PDF fixture';
 EXCEPTION WHEN SQLSTATE 'ZX404' THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.persons WHERE id=p) OR EXISTS(SELECT 1 FROM public.customers WHERE "Id"=c)
   OR EXISTS(SELECT 1 FROM public.crm_file_import_jobs WHERE id=job) OR EXISTS(SELECT 1 FROM public.photos WHERE id=photo)
 THEN RAISE EXCEPTION 'Fixture rollback failed'; END IF;
END $test$;
