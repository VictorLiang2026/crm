-- Fictional positive IDs only, transaction always rolls back, no sequence increments.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='45s';
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  actor text:='l07-fictional-actor'; req uuid:=gen_random_uuid();
  p jsonb; r jsonb; replay jsonb; q jsonb; rejected boolean; n integer;
BEGIN
  IF EXISTS(SELECT 1 FROM public.persons WHERE id BETWEEN 1900260701 AND 1900260799)
    OR EXISTS(SELECT 1 FROM public.customers WHERE "Id" BETWEEN 1900260701 AND 1900260799)
    OR EXISTS(SELECT 1 FROM public.recruit_candidates WHERE id BETWEEN 1900260701 AND 1900260799)
    OR EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=actor) THEN
    RAISE EXCEPTION 'L07 fictional fixture collision';
  END IF;
  INSERT INTO public.persons(id,display_name,name_key)
    SELECT i,'【系统测试·勿联系】L07 '||i,'l07fictional'||i FROM generate_series(1900260701,1900260710) i;
  UPDATE public.persons SET deleted_at=now() WHERE id=1900260707;
  INSERT INTO public.customers("Id",person_id,deleted_at,delete_batch_id) VALUES
    (1900260701,1900260701,now(),a),(1900260702,1900260702,now(),b),
    (1900260703,1900260703,now(),NULL),(1900260704,1900260704,NULL,NULL),
    (1900260705,1900260705,now(),c);
  INSERT INTO public.recruit_candidates(id,customer_id,person_id,deleted_at,delete_batch_id) VALUES
    (1900260711,1900260701,1900260701,now(),a),(1900260712,1900260701,1900260701,now(),b),
    (1900260713,1900260704,1900260704,now(),a),(1900260714,NULL,1900260706,now(),b),
    (1900260715,NULL,1900260707,now(),c),(1900260716,1900260704,1900260704,now(),c);
  INSERT INTO public.followups("Id",customer_id,customer_name,deleted_at,delete_batch_id) VALUES
    (1900260701,1900260701,'【系统测试·勿联系】L07',now(),a),
    (1900260702,1900260701,'【系统测试·勿联系】L07 old batch',now(),b),
    (1900260703,1900260703,'【系统测试·勿联系】L07 legacy child',now(),NULL);
  INSERT INTO public.gifts("Id",customer_id,customer_name,gift_name,deleted_at,delete_batch_id)
    VALUES(1900260701,1900260701,'【系统测试·勿联系】L07','fixture',now(),a);
  INSERT INTO public.photos(id,customer_id,customer_name,photo_url,deleted_at,delete_batch_id)
    VALUES(1900260701,1900260701,'【系统测试·勿联系】L07','fixture://never-uploaded',now(),a);
  INSERT INTO public.policy_review_reports(id,customer_id,deleted_at,delete_batch_id) VALUES(1900260701,1900260701,now(),a);
  INSERT INTO public.ocr_records(id,customer_id,deleted_at,delete_batch_id) VALUES(1900260701,1900260701,now(),a);
  INSERT INTO public.products(id,customer_id,customer_name,deleted_at,delete_batch_id)
    VALUES(1900260701,1900260701,'【系统测试·勿联系】L07',now(),a);
  INSERT INTO public.recruit_followups(id,candidate_id,followup_date,deleted_at,delete_batch_id) VALUES
    (1900260701,1900260711,current_date,now(),a),(1900260702,1900260711,current_date,now(),b),
    (1900260703,1900260713,current_date,now(),a),(1900260704,1900260714,current_date,now(),b);

  p:=public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',req,'items',
    '[{"kind":"customer","id":1900260701},{"kind":"customer","id":1900260702},{"kind":"customer","id":1900260703},{"kind":"customer","id":1900260705}]'::jsonb));
  IF p->'items'->0->>'code'<>'READY' OR (p->'items'->0->>'linkedCount')::int<>8
    OR p->'items'->2->>'linkedCount'<>'0' THEN RAISE EXCEPTION 'Invalid verified scope: %',p; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE "Id"=1900260701 AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Preview wrote business data'; END IF;
  replay:=public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',req,'items',
    '[{"kind":"customer","id":1900260705},{"kind":"customer","id":1900260703},{"kind":"customer","id":1900260702},{"kind":"customer","id":1900260701}]'::jsonb));
  IF replay IS DISTINCT FROM p THEN RAISE EXCEPTION 'Preview retry not idempotent'; END IF;
  rejected:=false;
  BEGIN PERFORM public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',req,'items','[{"kind":"customer","id":1900260701}]'::jsonb));
    EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Request key reused with different scope'; END IF;
  rejected:=false;
  BEGIN PERFORM public.crm_recycle_batch_v1('different-actor','get',jsonb_build_object('previewId',p->>'previewId'));
    EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Another actor read the receipt'; END IF;
  -- Add a new member AFTER preview: original root and its entire item must stay deleted.
  INSERT INTO public.followups("Id",customer_id,customer_name,deleted_at,delete_batch_id)
    VALUES(1900260705,1900260705,'【系统测试·勿联系】L07 changed',now(),c);
  r:=public.crm_recycle_batch_v1(actor,'execute',jsonb_build_object('previewId',p->>'previewId'));
  IF r->>'status'<>'executed' OR r->'results'->0->>'code'<>'RESTORED'
    OR r->'results'->1->>'code'<>'RESTORED' OR r->'results'->2->>'code'<>'RESTORED'
    OR r->'results'->3->>'code'<>'STALE_SCOPE' THEN RAISE EXCEPTION 'Partial receipt mismatch: %',r; END IF;
  IF EXISTS(SELECT 1 FROM public.customers WHERE "Id" IN(1900260701,1900260702,1900260703) AND deleted_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.followups WHERE "Id"=1900260701 AND deleted_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.gifts WHERE "Id"=1900260701 AND deleted_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.photos WHERE id=1900260701 AND deleted_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.products WHERE id=1900260701 AND deleted_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.ocr_records WHERE id=1900260701 AND deleted_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.policy_review_reports WHERE id=1900260701 AND deleted_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.recruit_candidates WHERE id=1900260711 AND deleted_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.recruit_followups WHERE id=1900260701 AND deleted_at IS NOT NULL)
    THEN RAISE EXCEPTION 'Current batch was not fully restored'; END IF;
  IF EXISTS(SELECT 1 FROM public.followups WHERE "Id" IN(1900260702,1900260703,1900260705) AND deleted_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.recruit_candidates WHERE id=1900260712 AND deleted_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.recruit_followups WHERE id=1900260702 AND deleted_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.customers WHERE "Id"=1900260705 AND deleted_at IS NULL)
    THEN RAISE EXCEPTION 'Unconfirmed membership restored'; END IF;
  UPDATE public.crm_recycle_commands SET expires_at=now()-interval '1 minute' WHERE id=(p->>'previewId')::uuid;
  replay:=public.crm_recycle_batch_v1(actor,'execute',jsonb_build_object('previewId',p->>'previewId'));
  IF replay->'results' IS DISTINCT FROM r->'results' THEN RAISE EXCEPTION 'Repeated execution lost receipt'; END IF;
  replay:=public.crm_recycle_batch_v1(actor,'get',jsonb_build_object('previewId',p->>'previewId'));
  IF replay->'results' IS DISTINCT FROM r->'results' THEN RAISE EXCEPTION 'Reconnect lost receipt'; END IF;
  p:=public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',gen_random_uuid(),'items','[{"kind":"customer","id":1900260705}]'::jsonb));
  r:=public.crm_recycle_batch_v1(actor,'execute',jsonb_build_object('previewId',p->>'previewId'));
  IF jsonb_array_length(r->'results')<>1 OR r->'results'->0->>'code'<>'RESTORED' THEN RAISE EXCEPTION 'Failed-only retry failed'; END IF;
  p:=public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',gen_random_uuid(),'items','[{"kind":"customer","id":1900260701}]'::jsonb));
  IF p->'items'->0->>'code'<>'ALREADY_RESTORED' THEN RAISE EXCEPTION 'Already-active root misclassified'; END IF;

  -- A late root uniqueness failure must roll back a child restored earlier in that item.
  INSERT INTO public.recruit_followups(id,candidate_id,followup_date,deleted_at,delete_batch_id)
    VALUES(1900260712,1900260712,current_date,now(),b);
  p:=public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',gen_random_uuid(),'items','[{"kind":"recruit","id":1900260712}]'::jsonb));
  r:=public.crm_recycle_batch_v1(actor,'execute',jsonb_build_object('previewId',p->>'previewId'));
  IF r->'results'->0->>'code'<>'FAILED'
    OR EXISTS(SELECT 1 FROM public.recruit_followups WHERE id=1900260712 AND deleted_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.recruit_candidates WHERE id=1900260712 AND deleted_at IS NULL)
    THEN RAISE EXCEPTION 'Failed item retained a partial write'; END IF;

  p:=public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',gen_random_uuid(),'items',
    '[{"kind":"recruit","id":1900260713},{"kind":"person_recruit","id":1900260714},{"kind":"person_recruit","id":1900260715}]'::jsonb));
  UPDATE public.persons SET deleted_at=NULL WHERE id=1900260707;
  r:=public.crm_recycle_batch_v1(actor,'execute',jsonb_build_object('previewId',p->>'previewId'));
  SELECT count(*) INTO n FROM jsonb_array_elements(r->'results') x WHERE x->>'code'='RESTORED';
  IF n<>2 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'results') x WHERE x->>'code'='PARENT_DELETED')
    OR NOT EXISTS(SELECT 1 FROM public.recruit_candidates WHERE id=1900260715 AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Blocked scope escalated: %',r; END IF;
  IF EXISTS(SELECT 1 FROM public.recruit_followups WHERE id IN(1900260703,1900260704) AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Candidate children not restored'; END IF;
  p:=public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',gen_random_uuid(),'items','[{"kind":"recruit","id":1900260716}]'::jsonb));
  UPDATE public.recruit_candidates SET customer_id=1900260702,person_id=1900260702 WHERE id=1900260716;
  r:=public.crm_recycle_batch_v1(actor,'execute',jsonb_build_object('previewId',p->>'previewId'));
  IF r->'results'->0->>'code'<>'STALE_SCOPE' THEN RAISE EXCEPTION 'Changed parent was restored'; END IF;
  p:=public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',gen_random_uuid(),'items','[{"kind":"person_recruit","id":1900260715}]'::jsonb));
  UPDATE public.crm_recycle_commands SET expires_at=now()-interval '1 minute' WHERE id=(p->>'previewId')::uuid;
  rejected:=false;
  BEGIN PERFORM public.crm_recycle_batch_v1(actor,'execute',jsonb_build_object('previewId',p->>'previewId'));
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Preview expired%' THEN rejected:=true; ELSE RAISE; END IF; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expired preview executed'; END IF;
  -- Test actor cannot disclose or restore an unregistered fixture even when it has the visible marker.
  INSERT INTO public.crm_test_batches(batch_key,created_by_uid) VALUES('crm_test_l07_rollback',actor);
  p:=public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',gen_random_uuid(),'items','[{"kind":"person_recruit","id":1900260715}]'::jsonb));
  IF p->'items'->0->>'code'<>'FORBIDDEN' OR (p->'items'->0 ? 'name') THEN RAISE EXCEPTION 'Test guard failed'; END IF;
  r:=public.crm_recycle_batch_v1(actor,'execute',jsonb_build_object('previewId',p->>'previewId'));
  IF r->'results'->0->>'code'<>'FORBIDDEN' THEN RAISE EXCEPTION 'Test guard execution failed'; END IF;

  -- Derive temporary test records from the existing protected fictional fixture;
  -- neither that parent nor its registry entry is modified. Everything here rolls back.
  SELECT b.created_by_uid INTO actor FROM public.crm_test_batches b
    JOIN public.crm_test_records r ON r.batch_key=b.batch_key AND r.record_table='persons' AND r.record_id='786'
    JOIN public.persons x ON x.id=786 AND position('【系统测试·勿联系】' IN x.display_name)>0
    WHERE b.batch_key='crm_test_main_v1';
  IF actor IS NULL THEN RAISE EXCEPTION 'Protected fictional fixture 786 missing'; END IF;
  INSERT INTO public.recruit_followups(id,candidate_id,followup_date,deleted_at,delete_batch_id)
    VALUES(1900260715,1900260715,current_date,now(),c);
  INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,parent_table,parent_id,visible_label) VALUES
    ('crm_test_main_v1','persons','1900260707','derived','persons','786','【系统测试·勿联系】L07 parent'),
    ('crm_test_main_v1','recruit_candidates','1900260715','derived','persons','1900260707','【系统测试·勿联系】L07 candidate');
  p:=public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',gen_random_uuid(),'items','[{"kind":"person_recruit","id":1900260715}]'::jsonb));
  IF p->'items'->0->>'code'<>'FORBIDDEN' THEN RAISE EXCEPTION 'Untracked child was allowed'; END IF;
  INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,parent_table,parent_id,visible_label)
    VALUES('crm_test_main_v1','recruit_followups','1900260715','derived','recruit_candidates','1900260715','【系统测试·勿联系】L07 child');
  p:=public.crm_recycle_batch_v1(actor,'preview',jsonb_build_object('requestKey',gen_random_uuid(),'items','[{"kind":"person_recruit","id":1900260715}]'::jsonb));
  IF p->'items'->0->>'code'<>'READY' THEN RAISE EXCEPTION 'Tracked test scope denied: %',p; END IF;
  r:=public.crm_recycle_batch_v1(actor,'execute',jsonb_build_object('previewId',p->>'previewId'));
  IF r->'results'->0->>'code'<>'RESTORED' THEN RAISE EXCEPTION 'Tracked test execution denied'; END IF;
END;
$test$;
ROLLBACK;
