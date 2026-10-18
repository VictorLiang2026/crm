-- PC32-D: registered fictional Person 783; all new rows and changes roll back.
DO $test$
DECLARE
  v_actor text := '2102162853214060545';
  v_other text := '[CRM_TEST_ONLY] PC32-D other actor';
  v_person_id bigint := 783;
  v_name text := '【系统测试·勿联系】虚构体验甲';
  v_key uuid := pg_catalog.gen_random_uuid();
  v_payload jsonb;
  v_preview jsonb;
  v_preview_id uuid;
  v_result jsonb;
  v_interaction_id bigint;
  v_failed_interaction_id bigint;
  v_blocked boolean;
  v_checks integer := 0;
BEGIN
  IF current_user<>'service_role' OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records
    WHERE batch_key='crm_test_main_v1' AND record_table='persons'
      AND record_id=v_person_id::text) OR NOT EXISTS(
    SELECT 1 FROM public.persons WHERE id=v_person_id AND display_name=v_name
      AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'PC32-D registered fictional Person unavailable'; END IF;
  v_payload:=jsonb_build_object('display_name',v_name,'name_key',lower(v_name),
    'person_id',v_person_id,'source','人工新增','occupation','',
    'organization','','education','',
    'interaction',jsonb_build_object('type','微信','at',
      to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'channel','','summary','【系统测试·勿联系】PC32-D 虚构摘要',
      'rawNote','【系统测试·勿联系】纯虚构原话'),
    'facts',jsonb_build_array('【系统测试·勿联系】虚构事实'),
    'signals',jsonb_build_array('【系统测试·勿联系】虚构信号'));
  BEGIN
    v_blocked:=false;
    BEGIN
      PERFORM public.person_identity_preview_v1(v_actor,pg_catalog.gen_random_uuid(),
        'capture_v2_existing',v_payload-'person_id');
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Selected Person is required' THEN v_blocked:=true;
      ELSE RAISE; END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-D accepted missing selected Person'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.person_identity_preview_v1(v_actor,pg_catalog.gen_random_uuid(),
        'capture_v2_existing',v_payload||jsonb_build_object('unexpected',true));
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Invalid Quick Capture preview' THEN v_blocked:=true;
      ELSE RAISE; END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-D accepted extra preview input'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.person_identity_preview_v1(v_actor,pg_catalog.gen_random_uuid(),
        'capture_v2_existing',jsonb_set(v_payload,'{person_id}',to_jsonb(784::bigint)));
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Selected Person changed; resolve identity again' THEN v_blocked:=true;
      ELSE RAISE; END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-D accepted mismatched Person'; END IF;
    v_checks:=v_checks+1;
    v_preview:=public.person_identity_preview_v1(v_actor,v_key,'capture_v2_existing',v_payload);
    v_preview_id:=(v_preview->>'previewId')::uuid;
    IF v_preview_id IS NULL OR (v_preview->'preview'->>'personId')::bigint<>v_person_id OR
       v_preview->'preview'->'interaction'<>v_payload->'interaction' OR
       v_preview->'preview'->'facts'<>v_payload->'facts' OR
       v_preview->'preview'->'signals'<>v_payload->'signals' OR
       EXISTS(SELECT 1 FROM public.interactions WHERE summary='【系统测试·勿联系】PC32-D 虚构摘要')
    THEN RAISE EXCEPTION 'PC32-D server preview incomplete or wrote business rows'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.person_identity_preview_v1(v_actor,v_key,'capture_v2_existing',v_payload);
    IF (v_result->>'previewId')::uuid<>v_preview_id THEN
      RAISE EXCEPTION 'PC32-D same request did not reuse preview'; END IF;
    v_checks:=v_checks+1;
    FOREACH v_result IN ARRAY ARRAY[
      jsonb_set(v_payload,'{person_id}',to_jsonb(784::bigint)),
      jsonb_set(v_payload,'{facts,0}',to_jsonb('【系统测试·勿联系】改动'::text)),
      jsonb_set(v_payload,'{interaction,summary}',to_jsonb('【系统测试·勿联系】改动'::text)),
      jsonb_set(v_payload,'{signals,0}',to_jsonb('【系统测试·勿联系】改动'::text))]
    LOOP
      v_blocked:=false;
      BEGIN
        PERFORM public.person_identity_preview_v1(v_actor,v_key,'capture_v2_existing',v_result);
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM='Idempotency key belongs to another command' THEN v_blocked:=true;
        ELSE RAISE; END IF;
      END;
      IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-D key accepted changed Person/content'; END IF;
      v_checks:=v_checks+1;
    END LOOP;
    v_blocked:=false;
    BEGIN
      PERFORM public.person_identity_preview_v1(v_other,v_key,'capture_v2_existing',v_payload);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Idempotency key belongs to another account' THEN v_blocked:=true;
      ELSE RAISE; END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-D key accepted different actor'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.person_identity_execute_v1(v_other,v_preview_id);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Preview not found for this account' THEN v_blocked:=true;
      ELSE RAISE; END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-D execution accepted other actor'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      UPDATE public.persons SET updated_at=updated_at+interval '1 second'
        WHERE id=v_person_id;
      v_blocked:=false;
      BEGIN
        PERFORM public.person_identity_execute_v1(v_actor,v_preview_id);
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM='Identity candidates changed; preview again' THEN v_blocked:=true;
        ELSE RAISE; END IF;
      END;
      IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-D accepted stale Person version'; END IF;
      RAISE EXCEPTION 'PC32_D_VERSION_ROLLBACK' USING ERRCODE='P32D1';
    EXCEPTION WHEN SQLSTATE 'P32D1' THEN NULL;
    END;
    v_checks:=v_checks+1;
    BEGIN
      UPDATE public.person_identity_commands SET expires_at=now()-interval '1 second'
        WHERE id=v_preview_id;
      v_blocked:=false;
      BEGIN
        PERFORM public.person_identity_execute_v1(v_actor,v_preview_id);
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM='Preview expired' THEN v_blocked:=true;
        ELSE RAISE; END IF;
      END;
      IF NOT v_blocked THEN RAISE EXCEPTION 'PC32-D accepted expired preview'; END IF;
      RAISE EXCEPTION 'PC32_D_EXPIRY_ROLLBACK' USING ERRCODE='P32D2';
    EXCEPTION WHEN SQLSTATE 'P32D2' THEN NULL;
    END;
    v_checks:=v_checks+1;
    BEGIN
      v_result:=public.person_identity_execute_v1(v_actor,v_preview_id);
      v_failed_interaction_id:=(v_result->>'interactionId')::bigint;
      IF (v_result->>'personId')::bigint<>v_person_id OR
         v_failed_interaction_id IS NULL OR
         (v_result->>'contextItemCount')::integer<>2 OR
         (SELECT count(*) FROM public.context_items
           WHERE interaction_id=v_failed_interaction_id AND confirmed=false)<>2 OR
         NOT EXISTS(SELECT 1 FROM public.person_identity_commands
           WHERE id=v_preview_id AND status='executed')
      THEN RAISE EXCEPTION 'PC32-D atomic save incomplete'; END IF;
      RAISE EXCEPTION 'PC32_D_INJECTED_FAILURE' USING ERRCODE='P32D3';
    EXCEPTION WHEN SQLSTATE 'P32D3' THEN NULL;
    END;
    IF EXISTS(SELECT 1 FROM public.interactions WHERE id=v_failed_interaction_id) OR
       EXISTS(SELECT 1 FROM public.context_items WHERE interaction_id=v_failed_interaction_id) OR
       NOT EXISTS(SELECT 1 FROM public.person_identity_commands
         WHERE id=v_preview_id AND status='preview')
    THEN RAISE EXCEPTION 'PC32-D failed write left partial state'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.person_identity_execute_v1(v_actor,v_preview_id);
    v_interaction_id:=(v_result->>'interactionId')::bigint;
    IF v_interaction_id IS NULL OR
       (SELECT count(*) FROM public.interactions
         WHERE id=v_interaction_id AND person_id=v_person_id)<>1 OR
       (SELECT count(*) FROM public.context_items WHERE interaction_id=v_interaction_id)<>2
    THEN RAISE EXCEPTION 'PC32-D retry did not save exactly once'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.person_identity_execute_v1(v_actor,v_preview_id);
    IF (v_result->>'interactionId')::bigint<>v_interaction_id OR
       (SELECT count(*) FROM public.interactions
         WHERE summary='【系统测试·勿联系】PC32-D 虚构摘要')<>1
    THEN RAISE EXCEPTION 'PC32-D replay duplicated interaction'; END IF;
    v_checks:=v_checks+1;
    RAISE EXCEPTION 'PC32_D_TEST_ROLLBACK' USING ERRCODE='P32D0';
  EXCEPTION WHEN SQLSTATE 'P32D0' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.person_identity_commands WHERE id=v_preview_id) OR
     EXISTS(SELECT 1 FROM public.interactions WHERE id IN (v_interaction_id,v_failed_interaction_id))
  THEN RAISE EXCEPTION 'PC32-D test leaked rows'; END IF;
  RAISE NOTICE 'PC32-D existing capture passed % checks; all writes rolled back',v_checks;
END $test$;
