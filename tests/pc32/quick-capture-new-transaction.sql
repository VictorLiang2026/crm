-- PC32-C: all rows are fictional and rolled back, including the receipt.
DO $test$
DECLARE
  v_actor text := '2102162853214060545';
  v_other text := '[CRM_TEST_ONLY] PC32-C other actor';
  v_name text := '【系统测试·勿联系】PC32-C ' || left(pg_catalog.gen_random_uuid()::text,8);
  v_key uuid := pg_catalog.gen_random_uuid();
  v_payload jsonb;
  v_preview jsonb;
  v_preview_id uuid;
  v_result jsonb;
  v_person_id bigint;
  v_interaction_id bigint;
  v_failed_person bigint;
  v_failed_interaction bigint;
  v_blocked boolean;
  v_checks integer := 0;
BEGIN
  IF current_user<>'service_role' OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_batches
    WHERE batch_key='crm_test_main_v1' AND created_by_uid=v_actor)
  THEN RAISE EXCEPTION 'PC32-C registered fictional actor unavailable'; END IF;
  v_payload:=jsonb_build_object('display_name',v_name,'name_key',lower(v_name),
    'source','人工新增','occupation','','organization','','education','',
    'interaction',jsonb_build_object('type','微信','at',
      to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'channel','','summary','【系统测试·勿联系】虚构摘要',
      'rawNote','【系统测试·勿联系】纯虚构原话'),
    'facts',jsonb_build_array('【系统测试·勿联系】虚构事实'),
    'signals',jsonb_build_array('【系统测试·勿联系】虚构信号'));
  BEGIN
    v_preview:=public.person_identity_preview_v1(v_actor,v_key,'capture_v2_new',v_payload);
    v_preview_id:=(v_preview->>'previewId')::uuid;
    IF v_preview_id IS NULL OR v_preview->'preview'->'interaction'<>v_payload->'interaction'
      OR v_preview->'preview'->'facts'<>v_payload->'facts'
      OR EXISTS(SELECT 1 FROM public.persons WHERE display_name=v_name)
    THEN RAISE EXCEPTION 'PC32-C server preview incomplete or wrote Person'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.person_identity_preview_v1(v_actor,v_key,'capture_v2_new',v_payload);
    IF (v_result->>'previewId')::uuid<>v_preview_id THEN
      RAISE EXCEPTION 'PC32-C same preview did not replay'; END IF;
    v_checks:=v_checks+1;
    FOREACH v_result IN ARRAY ARRAY[
      jsonb_set(v_payload,'{facts,0}',to_jsonb('【系统测试·勿联系】改动'::text)),
      jsonb_set(v_payload,'{interaction,rawNote}',to_jsonb('【系统测试·勿联系】改动'::text)),
      jsonb_set(v_payload,'{signals,0}',to_jsonb('【系统测试·勿联系】改动'::text))]
    LOOP
      v_blocked:=false;
      BEGIN
        PERFORM public.person_identity_preview_v1(v_actor,v_key,'capture_v2_new',v_result);
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM='Idempotency key belongs to another command' THEN v_blocked:=true;
        ELSE RAISE; END IF;
      END;
      IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-C key accepted changed content'; END IF;
      v_checks:=v_checks+1;
    END LOOP;
    v_blocked:=false;
    BEGIN
      PERFORM public.person_identity_preview_v1(v_other,v_key,'capture_v2_new',v_payload);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Idempotency key belongs to another account' THEN v_blocked:=true;
      ELSE RAISE; END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-C key accepted another actor'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.person_identity_execute_v1(v_other,v_preview_id);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Preview not found for this account' THEN v_blocked:=true;
      ELSE RAISE; END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-C execution accepted another actor'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      v_result:=public.person_identity_execute_v1(v_actor,v_preview_id);
      v_failed_person:=(v_result->>'personId')::bigint;
      v_failed_interaction:=(v_result->>'interactionId')::bigint;
      IF v_failed_person IS NULL OR v_failed_interaction IS NULL OR
        (v_result->>'contextItemCount')::integer<>2 OR
        (SELECT count(*) FROM public.context_items
          WHERE interaction_id=v_failed_interaction AND confirmed=false)<>2 OR
        NOT EXISTS(SELECT 1 FROM public.crm_test_records WHERE batch_key='crm_test_main_v1'
          AND record_table='persons' AND record_id=v_failed_person::text) OR
        NOT EXISTS(SELECT 1 FROM public.person_identity_commands
          WHERE id=v_preview_id AND status='executed')
      THEN RAISE EXCEPTION 'PC32-C atomic write incomplete'; END IF;
      RAISE EXCEPTION 'PC32_C_INJECTED_FAILURE' USING ERRCODE='P32C1';
    EXCEPTION WHEN SQLSTATE 'P32C1' THEN NULL;
    END;
    IF EXISTS(SELECT 1 FROM public.persons WHERE id=v_failed_person) OR
       EXISTS(SELECT 1 FROM public.interactions WHERE id=v_failed_interaction) OR
       EXISTS(SELECT 1 FROM public.context_items WHERE interaction_id=v_failed_interaction) OR
       NOT EXISTS(SELECT 1 FROM public.person_identity_commands
         WHERE id=v_preview_id AND status='preview')
    THEN RAISE EXCEPTION 'PC32-C failure left partial state'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.person_identity_execute_v1(v_actor,v_preview_id);
    v_person_id:=(v_result->>'personId')::bigint;
    v_interaction_id:=(v_result->>'interactionId')::bigint;
    IF v_person_id IS NULL OR v_interaction_id IS NULL OR
       (SELECT count(*) FROM public.persons WHERE display_name=v_name)<>1 OR
       (SELECT count(*) FROM public.context_items WHERE interaction_id=v_interaction_id)<>2
    THEN RAISE EXCEPTION 'PC32-C retry did not save exactly once'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.person_identity_execute_v1(v_actor,v_preview_id);
    IF (v_result->>'personId')::bigint<>v_person_id OR
       (v_result->>'interactionId')::bigint<>v_interaction_id OR
       (SELECT count(*) FROM public.interactions WHERE person_id=v_person_id)<>1
    THEN RAISE EXCEPTION 'PC32-C execution replay duplicated data'; END IF;
    v_checks:=v_checks+1;
    RAISE EXCEPTION 'PC32_C_TEST_ROLLBACK' USING ERRCODE='P32C0';
  EXCEPTION WHEN SQLSTATE 'P32C0' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.persons WHERE display_name=v_name) OR
     EXISTS(SELECT 1 FROM public.interactions WHERE id IN (v_interaction_id,v_failed_interaction)) OR
     EXISTS(SELECT 1 FROM public.person_identity_commands WHERE id=v_preview_id)
  THEN RAISE EXCEPTION 'PC32-C test leaked fictional data'; END IF;
  RAISE NOTICE 'PC32-C atomic new capture passed % checks; all rows rolled back',v_checks;
END $test$;
