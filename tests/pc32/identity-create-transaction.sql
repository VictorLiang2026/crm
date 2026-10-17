-- PC32 identity creation: a unique marked fictional Person name and test actor.
-- New Person, derived ledger and command execution all roll back.
DO $test$
DECLARE
  v_actor text := '2102162853214060545';
  v_other text := '[CRM_TEST_ONLY] PC32 other identity actor';
  v_name text := '【系统测试·勿联系】PC32身份故障 ' ||
    left(pg_catalog.gen_random_uuid()::text,8);
  v_name_key text;
  v_key uuid := pg_catalog.gen_random_uuid();
  v_other_key uuid := pg_catalog.gen_random_uuid();
  v_payload jsonb;
  v_preview jsonb;
  v_preview_id uuid;
  v_result jsonb;
  v_person_id bigint;
  v_failed_person_id bigint;
  v_blocked boolean;
  v_checks integer := 0;
BEGIN
  IF current_user<>'service_role' OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_batches
    WHERE batch_key='crm_test_main_v1' AND created_by_uid=v_actor)
  THEN RAISE EXCEPTION 'PC32 registered fictional identity actor unavailable'; END IF;
  v_name_key:=lower(v_name);
  v_payload:=jsonb_build_object('display_name',v_name,'name_key',v_name_key);
  IF EXISTS(SELECT 1 FROM public.persons WHERE display_name=v_name) OR
     EXISTS(SELECT 1 FROM public.person_identity_commands
       WHERE actor_uid=v_actor AND idempotency_key=v_key)
  THEN RAISE EXCEPTION 'PC32 generated identity fixture collided'; END IF;
  BEGIN
  v_preview:=public.person_identity_preview_v1(v_actor,v_key,'person',v_payload);
  v_preview_id:=(v_preview->>'previewId')::uuid;
  IF v_preview_id IS NULL OR v_preview->'preview'->>'newPerson'<>'true' OR
     EXISTS(SELECT 1 FROM public.persons WHERE display_name=v_name)
  THEN RAISE EXCEPTION 'PC32 identity preview created Person'; END IF;
  v_checks:=v_checks+1;
  v_result:=public.person_identity_preview_v1(v_actor,v_key,'person',v_payload);
  IF (v_result->>'previewId')::uuid<>v_preview_id OR
     (SELECT count(*) FROM public.person_identity_commands
       WHERE actor_uid=v_actor AND idempotency_key=v_key)<>1
  THEN RAISE EXCEPTION 'PC32 identity preview replay created another command'; END IF;
  v_checks:=v_checks+1;
  v_blocked:=false;
  BEGIN
    PERFORM public.person_identity_preview_v1(v_actor,v_key,'person',
      jsonb_set(v_payload,'{display_name}',to_jsonb((v_name || ' changed')::text)));
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Idempotency key belongs to another command' THEN v_blocked:=true;
    ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 identity key accepted changed payload'; END IF;
  v_checks:=v_checks+1;
  v_blocked:=false;
  BEGIN
    PERFORM public.person_identity_execute_v1(v_other,v_preview_id);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Preview not found for this account' THEN v_blocked:=true;
    ELSE RAISE; END IF;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 identity execute accepted other actor'; END IF;
  v_checks:=v_checks+1;
    BEGIN
      v_result:=public.person_identity_execute_v1(v_actor,v_preview_id);
      v_failed_person_id:=(v_result->>'personId')::bigint;
      IF v_failed_person_id IS NULL OR NOT EXISTS(
        SELECT 1 FROM public.persons WHERE id=v_failed_person_id AND
          display_name=v_name AND source='人工新增') OR NOT EXISTS(
        SELECT 1 FROM public.crm_test_records WHERE batch_key='crm_test_main_v1'
          AND record_table='persons' AND record_id=v_failed_person_id::text
          AND origin='derived') OR NOT EXISTS(
        SELECT 1 FROM public.person_identity_commands
        WHERE id=v_preview_id AND status='executed')
      THEN RAISE EXCEPTION 'PC32 identity first execute lacked Person or ledger'; END IF;
      RAISE EXCEPTION 'PC32 injected post-create failure' USING ERRCODE='P32I1';
    EXCEPTION WHEN SQLSTATE 'P32I1' THEN NULL;
    END;
    IF EXISTS(SELECT 1 FROM public.persons WHERE display_name=v_name) OR
       EXISTS(SELECT 1 FROM public.crm_test_records
         WHERE record_table='persons' AND record_id=v_failed_person_id::text) OR
       NOT EXISTS(SELECT 1 FROM public.person_identity_commands
         WHERE id=v_preview_id AND status='preview' AND executed_at IS NULL)
    THEN RAISE EXCEPTION 'PC32 identity failure left partial state'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.person_identity_execute_v1(v_actor,v_preview_id);
    v_person_id:=(v_result->>'personId')::bigint;
    IF v_person_id IS NULL OR
       (SELECT count(*) FROM public.persons WHERE display_name=v_name)<>1 OR
       NOT EXISTS(SELECT 1 FROM public.crm_test_records
         WHERE batch_key='crm_test_main_v1' AND record_table='persons'
           AND record_id=v_person_id::text AND origin='derived')
    THEN RAISE EXCEPTION 'PC32 identity retry did not create once'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.person_identity_execute_v1(v_actor,v_preview_id);
    IF (v_result->>'personId')::bigint<>v_person_id OR
       (SELECT count(*) FROM public.persons WHERE display_name=v_name)<>1
    THEN RAISE EXCEPTION 'PC32 identity execution replay created another Person'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.person_identity_preview_v1(v_actor,v_other_key,'person',v_payload);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='Same-name Person requires explicit identity review and qualifier'
        THEN v_blocked:=true; ELSE RAISE; END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 identity second command accepted same name'; END IF;
    v_checks:=v_checks+1;
    RAISE EXCEPTION 'PC32_IDENTITY_TEST_ROLLBACK' USING ERRCODE='P32I0';
  EXCEPTION WHEN SQLSTATE 'P32I0' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.persons WHERE display_name=v_name) OR
     EXISTS(SELECT 1 FROM public.crm_test_records WHERE record_table='persons'
       AND record_id IN (v_person_id::text,v_failed_person_id::text)) OR
     EXISTS(SELECT 1 FROM public.person_identity_commands WHERE id=v_preview_id)
  THEN RAISE EXCEPTION 'PC32 identity test leaked Person, command or ledger'; END IF;
  RAISE NOTICE 'PC32 identity create passed % checks; all fictional rows rolled back',v_checks;
END $test$;
