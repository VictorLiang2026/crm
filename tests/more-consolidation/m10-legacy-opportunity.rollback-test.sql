-- service_role only; all synthetic data is rolled back in a subtransaction.
DO $test$
DECLARE person_key bigint:=9000000000000810; customer_key integer:=2147482810; opp_key bigint;
 action_key bigint:=9000000000000810; d jsonb; p jsonb; q jsonb; r jsonb; token uuid;
 actor text:='m10-rollback-test'; rejected boolean; before_commands bigint; initial_progress text;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Test must run as service_role'; END IF;
 IF EXISTS(SELECT 1 FROM public.persons WHERE id IN (person_key,person_key+1)) OR
    EXISTS(SELECT 1 FROM public.customers WHERE "Id"=customer_key) OR
    EXISTS(SELECT 1 FROM public.actions WHERE id=action_key) OR
    EXISTS(SELECT 1 FROM public.crm_test_batches WHERE batch_key='crm_test_m10_rollback') THEN RAISE EXCEPTION 'Synthetic ID collision'; END IF;
 SELECT count(*) INTO before_commands FROM public.crm_legacy_opportunity_commands;
 BEGIN
   INSERT INTO public.persons(id,display_name,name_key) VALUES(person_key,'【系统测试·勿联系】M10甲','m10_test_a'),(person_key+1,'【系统测试·勿联系】M10乙','m10_test_b');
   INSERT INTO public.customers("Id",person_id) VALUES(customer_key,person_key);
   INSERT INTO public.opportunities(customer_id,opportunity_type,status,last_progress) VALUES(customer_key,'养老规划','发现','initial') RETURNING id INTO opp_key;
   d:=jsonb_build_object('idempotencyKey',gen_random_uuid(),'operation','edit','personId',person_key::text,
     'customerId',customer_key::text,'opportunityId',opp_key::text,'draft',jsonb_build_object('type','养老规划','status','沟通',
       'progress','updated','nextAction','meet','nextActionDate','2026-11-01','discoveredAt',NULL,'referredName','','referredRelation',''));
   p:=public.crm_legacy_opportunity_v1(actor,'preview',d);token:=(p->>'previewId')::uuid;
   q:=public.crm_legacy_opportunity_v1(actor,'preview',d);
   IF q->>'previewId'<>p->>'previewId' OR (SELECT last_progress FROM public.opportunities WHERE id=opp_key)<>'initial' THEN RAISE EXCEPTION 'Preview wrote business data or duplicated'; END IF;
   rejected:=false;BEGIN
     PERFORM public.crm_legacy_opportunity_v1('other-actor','execute',jsonb_build_object('previewId',token));
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Invalid legacy Opportunity preview';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Cross-actor execute accepted'; END IF;
   rejected:=false;BEGIN
     PERFORM public.crm_legacy_opportunity_v1(actor,'preview',jsonb_set(d,'{draft,progress}','"different"'));
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Idempotency key conflicts%';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Changed request reused key'; END IF;
   -- A committed subtransaction produces a different xmin, just as a separate API transaction does.
   BEGIN
     UPDATE public.opportunities SET last_progress='changed then restored' WHERE id=opp_key;
     UPDATE public.opportunities SET last_progress='initial' WHERE id=opp_key;
   EXCEPTION WHEN others THEN RAISE; END;
   rejected:=false;BEGIN
     PERFORM public.crm_legacy_opportunity_v1(actor,'execute',jsonb_build_object('previewId',token));
   EXCEPTION WHEN serialization_failure THEN rejected:=SQLERRM LIKE 'Opportunity or linked identity changed%';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Changed-and-restored version accepted'; END IF;
   d:=d||jsonb_build_object('idempotencyKey',gen_random_uuid());
   p:=public.crm_legacy_opportunity_v1(actor,'preview',d);token:=(p->>'previewId')::uuid;
   r:=public.crm_legacy_opportunity_v1(actor,'execute',jsonb_build_object('previewId',token));
   IF (r->>'opportunityId')::bigint<>opp_key OR (SELECT last_progress FROM public.opportunities WHERE id=opp_key)<>'updated' OR
      (SELECT person_id FROM public.opportunities WHERE id=opp_key) IS NOT NULL THEN RAISE EXCEPTION 'Same-ID update or null-link compatibility failed'; END IF;
   q:=public.crm_legacy_opportunity_v1(actor,'execute',jsonb_build_object('previewId',token));
   IF q->>'replayed'<>'true' THEN RAISE EXCEPTION 'Execute not idempotent'; END IF;
   rejected:=false;BEGIN
     PERFORM public.crm_opportunity_preview_v1(actor,gen_random_uuid(),'stage',person_key,opp_key,'{"status":"方案"}'::jsonb);
   EXCEPTION WHEN insufficient_privilege THEN rejected:=SQLERRM='Person-only Opportunity unavailable';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Person-only guard relaxed'; END IF;
   rejected:=false;BEGIN
     PERFORM public.crm_legacy_opportunity_v1(actor,'preview',jsonb_set(d||jsonb_build_object('idempotencyKey',gen_random_uuid()),'{draft,status}','"已介绍"'));
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Invalid legacy Opportunity type and stage%';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Mismatched status accepted'; END IF;
   BEGIN
     INSERT INTO public.crm_test_batches(batch_key,created_by_uid) VALUES('crm_test_m10_rollback',actor);
     rejected:=false;BEGIN
       PERFORM public.crm_legacy_opportunity_v1(actor,'preview',d||jsonb_build_object('idempotencyKey',gen_random_uuid()));
     EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Test account requires tracked fictional Opportunity%';END;
     IF NOT rejected THEN RAISE EXCEPTION 'Test account bypass accepted'; END IF;
     RAISE EXCEPTION USING ERRCODE='ZX012';
   EXCEPTION WHEN SQLSTATE 'ZX012' THEN NULL; END;
   d:=d||jsonb_build_object('idempotencyKey',gen_random_uuid(),'operation','stage','draft',jsonb_build_object('status','方案'));
   p:=public.crm_legacy_opportunity_v1(actor,'preview',d);token:=(p->>'previewId')::uuid;
   UPDATE public.crm_legacy_opportunity_commands SET expires_at=clock_timestamp()-interval '1 second' WHERE id=token;
   rejected:=false;BEGIN
     PERFORM public.crm_legacy_opportunity_v1(actor,'execute',jsonb_build_object('previewId',token));
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Opportunity preview expired%';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Expired preview accepted'; END IF;
   BEGIN
     UPDATE public.opportunities SET person_id=person_key+1 WHERE id=opp_key;
     rejected:=false;BEGIN
       PERFORM public.crm_legacy_opportunity_v1(actor,'preview',d||jsonb_build_object('idempotencyKey',gen_random_uuid()));
     EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Opportunity customer or Person association changed%';END;
     IF NOT rejected THEN RAISE EXCEPTION 'Mismatched Person link accepted'; END IF;
     RAISE EXCEPTION USING ERRCODE='ZX011';
   EXCEPTION WHEN SQLSTATE 'ZX011' THEN NULL; END;
   BEGIN
   INSERT INTO public.actions(id,person_id,opportunity_id,action_type,title,source,created_by_uid)
     VALUES(action_key,person_key,NULL,'followup','【系统测试·勿联系】M10行动','manual',actor);
   d:=d||jsonb_build_object('idempotencyKey',gen_random_uuid(),'operation','close',
     'draft',jsonb_build_object('status','关闭','result','【系统测试·勿联系】M10关闭结果','actionId',action_key::text));
   rejected:=false;BEGIN
     PERFORM public.crm_legacy_opportunity_v1(actor,'preview',d);
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Action is not linked%';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Unlinked Action accepted'; END IF;
   RAISE EXCEPTION USING ERRCODE='ZX013';
   EXCEPTION WHEN SQLSTATE 'ZX013' THEN NULL; END;
   INSERT INTO public.actions(id,person_id,opportunity_id,action_type,title,source,created_by_uid)
     VALUES(action_key,person_key,opp_key,'followup','【系统测试·勿联系】M10行动','manual',actor);
   p:=public.crm_legacy_opportunity_v1(actor,'preview',d);token:=(p->>'previewId')::uuid;
   r:=public.crm_legacy_opportunity_v1(actor,'execute',jsonb_build_object('previewId',token));
   q:=public.crm_legacy_opportunity_v1(actor,'execute',jsonb_build_object('previewId',token));
   IF q->>'outcomeId' IS DISTINCT FROM r->>'outcomeId' OR (SELECT count(*) FROM public.outcomes WHERE opportunity_id=opp_key)<>1 OR
      (SELECT status FROM public.opportunities WHERE id=opp_key)<>'关闭' THEN RAISE EXCEPTION 'Close/Outcome atomic idempotency failed'; END IF;
   rejected:=false;BEGIN
     PERFORM public.crm_legacy_opportunity_v1(actor,'preview',d||jsonb_build_object('idempotencyKey',gen_random_uuid()));
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Opportunity already closed';END;
   IF NOT rejected THEN RAISE EXCEPTION 'Closed Opportunity reclosed'; END IF;
   RAISE EXCEPTION USING ERRCODE='ZX010',MESSAGE='Rollback all M10 synthetic rows';
 EXCEPTION WHEN SQLSTATE 'ZX010' THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM public.persons WHERE id IN(person_key,person_key+1)) OR EXISTS(SELECT 1 FROM public.customers WHERE "Id"=customer_key) OR
    EXISTS(SELECT 1 FROM public.opportunities WHERE id=opp_key) OR EXISTS(SELECT 1 FROM public.actions WHERE id=action_key) OR
    EXISTS(SELECT 1 FROM public.outcomes WHERE opportunity_id=opp_key) OR
    (SELECT count(*) FROM public.crm_legacy_opportunity_commands)<>before_commands THEN RAISE EXCEPTION 'M10 rollback failed'; END IF;
END $test$;
