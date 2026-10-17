-- PC32 OCR apply/undo: registered fictional Person 783 and customer 788 only.
-- Source OCR row, derived ledger, commands and field changes all roll back.
DO $test$
DECLARE
  v_actor text := '2102162853214060545';
  v_other text := '[CRM_TEST_ONLY] PC32 other OCR actor';
  v_person_id bigint := 783;
  v_customer_id integer := 788;
  v_person_before public.persons%ROWTYPE;
  v_customer_before public.customers%ROWTYPE;
  v_ocr_id bigint;
  v_apply_key uuid := pg_catalog.gen_random_uuid();
  v_undo_key uuid := pg_catalog.gen_random_uuid();
  v_apply_id uuid;
  v_undo_id uuid;
  v_selected jsonb := jsonb_build_object(
    'occupation','【系统测试·勿联系】虚构 OCR 职业',
    'additional_info','【系统测试·勿联系】PC32 虚构 OCR 双字段核验');
  v_preview jsonb;
  v_result jsonb;
  v_before_ocr integer;
  v_blocked boolean;
  v_checks integer := 0;
BEGIN
  IF current_user<>'service_role' OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r
    WHERE r.batch_key='crm_test_main_v1' AND r.record_table='persons'
      AND r.record_id=v_person_id::text) OR NOT EXISTS(
    SELECT 1 FROM public.crm_test_records r
    WHERE r.batch_key='crm_test_main_v1' AND r.record_table='customers'
      AND r.record_id=v_customer_id::text)
  THEN RAISE EXCEPTION 'PC32 registered OCR identity unavailable'; END IF;
  SELECT * INTO v_person_before FROM public.persons
    WHERE id=v_person_id AND deleted_at IS NULL;
  SELECT * INTO v_customer_before FROM public.customers
    WHERE "Id"=v_customer_id AND person_id=v_person_id AND deleted_at IS NULL;
  IF v_person_before.id IS NULL OR v_customer_before."Id" IS NULL THEN
    RAISE EXCEPTION 'PC32 OCR Person/customer mapping changed';
  END IF;
  SELECT count(*) INTO v_before_ocr FROM public.ocr_records
    WHERE customer_id=v_customer_id;
  BEGIN
    INSERT INTO public.ocr_records(customer_id,summary,raw_text)
    VALUES(v_customer_id,'【系统测试·勿联系】PC32 OCR 事务测试来源',
      '【系统测试·勿联系】虚构文本；不含真实证件、电话或文件')
    RETURNING id INTO v_ocr_id;
    IF NOT EXISTS(SELECT 1 FROM public.crm_test_records r
      WHERE r.batch_key='crm_test_main_v1' AND r.record_table='ocr_records'
        AND r.record_id=v_ocr_id::text AND r.origin='derived')
    THEN RAISE EXCEPTION 'PC32 OCR derived source was not registered'; END IF;
    v_checks:=v_checks+1;
    v_preview:=public.crm_ocr_parse_preview_v1(v_actor,v_apply_key,
      v_person_id,v_customer_id,v_ocr_id,v_selected);
    v_apply_id:=(v_preview->>'previewId')::uuid;
    IF v_apply_id IS NULL OR v_preview->>'businessDataWritten'<>'false' OR
       EXISTS(SELECT 1 FROM public.persons WHERE id=v_person_id AND
         occupation IS DISTINCT FROM v_person_before.occupation) OR
       EXISTS(SELECT 1 FROM public.customers WHERE "Id"=v_customer_id AND
         additional_info IS DISTINCT FROM v_customer_before.additional_info)
    THEN RAISE EXCEPTION 'PC32 OCR preview wrote fields'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_ocr_parse_execute_v1(v_other,v_apply_id);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 OCR apply accepted another actor'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      UPDATE public.persons SET occupation='【系统测试·勿联系】并发人工修改',
        updated_at=clock_timestamp() WHERE id=v_person_id;
      v_blocked:=false;
      BEGIN
        PERFORM public.crm_ocr_parse_execute_v1(v_actor,v_apply_id);
      EXCEPTION WHEN SQLSTATE '40001' THEN v_blocked:=true;
      END;
      IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 OCR apply accepted changed Person'; END IF;
      RAISE EXCEPTION 'PC32 rollback pre-apply manual change' USING ERRCODE='P32O2';
    EXCEPTION WHEN SQLSTATE 'P32O2' THEN NULL;
    END;
    v_checks:=v_checks+1;
    BEGIN
      v_result:=public.crm_ocr_parse_execute_v1(v_actor,v_apply_id);
      IF v_result->>'replayed'<>'false' OR
         NOT EXISTS(SELECT 1 FROM public.persons WHERE id=v_person_id
           AND occupation=v_selected->>'occupation') OR
         NOT EXISTS(SELECT 1 FROM public.customers WHERE "Id"=v_customer_id
           AND additional_info=v_selected->>'additional_info')
      THEN RAISE EXCEPTION 'PC32 OCR first apply did not write both fields'; END IF;
      RAISE EXCEPTION 'PC32 injected post-apply failure' USING ERRCODE='P32O1';
    EXCEPTION WHEN SQLSTATE 'P32O1' THEN NULL;
    END;
    IF EXISTS(SELECT 1 FROM public.persons WHERE id=v_person_id AND
         (occupation IS DISTINCT FROM v_person_before.occupation OR
          updated_at IS DISTINCT FROM v_person_before.updated_at)) OR
       EXISTS(SELECT 1 FROM public.customers WHERE "Id"=v_customer_id AND
         (additional_info IS DISTINCT FROM v_customer_before.additional_info OR
          updated_at IS DISTINCT FROM v_customer_before.updated_at)) OR
       NOT EXISTS(SELECT 1 FROM public.crm_ocr_parse_commands
         WHERE id=v_apply_id AND status='preview' AND executed_at IS NULL)
    THEN RAISE EXCEPTION 'PC32 OCR post-apply fault left partial state'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_ocr_parse_execute_v1(v_actor,v_apply_id);
    IF v_result->>'replayed'<>'false' OR
       NOT EXISTS(SELECT 1 FROM public.crm_ocr_parse_commands
         WHERE id=v_apply_id AND status='executed') OR
       NOT EXISTS(SELECT 1 FROM public.persons WHERE id=v_person_id
         AND occupation=v_selected->>'occupation') OR
       NOT EXISTS(SELECT 1 FROM public.customers WHERE "Id"=v_customer_id
         AND additional_info=v_selected->>'additional_info')
    THEN RAISE EXCEPTION 'PC32 OCR apply retry did not complete atomically'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_ocr_parse_execute_v1(v_actor,v_apply_id);
    IF v_result->>'replayed'<>'true' OR
       (v_result->>'commandId')::uuid<>v_apply_id
    THEN RAISE EXCEPTION 'PC32 OCR apply replay lost original receipt'; END IF;
    v_checks:=v_checks+1;
    v_preview:=public.crm_ocr_parse_undo_preview_v1(v_actor,v_undo_key,v_apply_id);
    v_undo_id:=(v_preview->>'previewId')::uuid;
    IF v_undo_id IS NULL OR v_preview->>'businessDataWritten'<>'false' OR
       NOT EXISTS(SELECT 1 FROM public.crm_ocr_parse_commands
         WHERE id=v_apply_id AND status='executed')
    THEN RAISE EXCEPTION 'PC32 OCR undo preview changed business state'; END IF;
    v_checks:=v_checks+1;
    BEGIN
      UPDATE public.persons SET occupation='【系统测试·勿联系】后续人工修改',
        updated_at=clock_timestamp() WHERE id=v_person_id;
      v_blocked:=false;
      BEGIN
        PERFORM public.crm_ocr_parse_execute_v1(v_actor,v_undo_id);
      EXCEPTION WHEN SQLSTATE '40001' THEN v_blocked:=true;
      END;
      IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 OCR undo overwrote subsequent manual edit'; END IF;
      RAISE EXCEPTION 'PC32 rollback post-apply manual change' USING ERRCODE='P32O3';
    EXCEPTION WHEN SQLSTATE 'P32O3' THEN NULL;
    END;
    v_checks:=v_checks+1;
    BEGIN
      v_result:=public.crm_ocr_parse_execute_v1(v_actor,v_undo_id);
      IF v_result->>'replayed'<>'false' OR
         NOT EXISTS(SELECT 1 FROM public.crm_ocr_parse_commands
           WHERE id=v_apply_id AND status='undone' AND reversed_by_command_id=v_undo_id)
      THEN RAISE EXCEPTION 'PC32 OCR first undo failed'; END IF;
      RAISE EXCEPTION 'PC32 injected post-undo failure' USING ERRCODE='P32O4';
    EXCEPTION WHEN SQLSTATE 'P32O4' THEN NULL;
    END;
    IF NOT EXISTS(SELECT 1 FROM public.crm_ocr_parse_commands
         WHERE id=v_apply_id AND status='executed' AND reversed_by_command_id IS NULL) OR
       NOT EXISTS(SELECT 1 FROM public.crm_ocr_parse_commands
         WHERE id=v_undo_id AND status='preview' AND executed_at IS NULL) OR
       NOT EXISTS(SELECT 1 FROM public.persons WHERE id=v_person_id
         AND occupation=v_selected->>'occupation') OR
       NOT EXISTS(SELECT 1 FROM public.customers WHERE "Id"=v_customer_id
         AND additional_info=v_selected->>'additional_info')
    THEN RAISE EXCEPTION 'PC32 OCR post-undo fault left partial state'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_ocr_parse_execute_v1(v_actor,v_undo_id);
    IF v_result->>'replayed'<>'false' OR
       NOT EXISTS(SELECT 1 FROM public.persons WHERE id=v_person_id
         AND occupation IS NOT DISTINCT FROM v_person_before.occupation) OR
       NOT EXISTS(SELECT 1 FROM public.customers WHERE "Id"=v_customer_id
         AND additional_info IS NOT DISTINCT FROM v_customer_before.additional_info) OR
       NOT EXISTS(SELECT 1 FROM public.crm_ocr_parse_commands
         WHERE id=v_apply_id AND status='undone' AND reversed_by_command_id=v_undo_id)
    THEN RAISE EXCEPTION 'PC32 OCR undo retry did not restore both fields'; END IF;
    v_checks:=v_checks+1;
    v_result:=public.crm_ocr_parse_execute_v1(v_actor,v_undo_id);
    IF v_result->>'replayed'<>'true' OR (v_result->>'commandId')::uuid<>v_undo_id
    THEN RAISE EXCEPTION 'PC32 OCR undo replay lost original receipt'; END IF;
    v_checks:=v_checks+1;
    v_blocked:=false;
    BEGIN
      PERFORM public.crm_ocr_parse_execute_v1(v_other,v_undo_id);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked:=true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'PC32 OCR undo replay accepted another actor'; END IF;
    v_checks:=v_checks+1;
    RAISE EXCEPTION 'PC32_OCR_TEST_ROLLBACK' USING ERRCODE='P32O0';
  EXCEPTION WHEN SQLSTATE 'P32O0' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.ocr_records WHERE customer_id=v_customer_id)<>v_before_ocr OR
     EXISTS(SELECT 1 FROM public.crm_ocr_parse_commands
       WHERE id IN (v_apply_id,v_undo_id)) OR
     EXISTS(SELECT 1 FROM public.crm_test_records
       WHERE record_table='ocr_records' AND record_id=v_ocr_id::text) OR
     EXISTS(SELECT 1 FROM public.persons WHERE id=v_person_id AND
       (occupation IS DISTINCT FROM v_person_before.occupation OR
        updated_at IS DISTINCT FROM v_person_before.updated_at)) OR
     EXISTS(SELECT 1 FROM public.customers WHERE "Id"=v_customer_id AND
       (additional_info IS DISTINCT FROM v_customer_before.additional_info OR
        updated_at IS DISTINCT FROM v_customer_before.updated_at))
  THEN RAISE EXCEPTION 'PC32 OCR test leaked business or ledger changes'; END IF;
  RAISE NOTICE 'PC32 OCR apply/undo passed % checks; all derived rows rolled back',v_checks;
END $test$;
