-- Roll back row-version checks only when no OCR command audit exists.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.crm_ocr_parse_commands) THEN
    RAISE EXCEPTION 'PC14 audit history exists; preserve it and keep the version guards';
  END IF;
END $guard$;
DROP FUNCTION public.crm_ocr_parse_execute_v1(text,uuid);
DROP FUNCTION public.crm_ocr_parse_undo_preview_v1(text,uuid,uuid);
DROP FUNCTION public.crm_ocr_parse_preview_v1(text,uuid,bigint,integer,bigint,jsonb);
CREATE FUNCTION public.crm_ocr_parse_preview_v1(
  p_actor_uid text,p_idempotency_key uuid,p_person_id bigint,p_customer_id integer,
  p_ocr_record_id bigint,p_selected jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $preview$
DECLARE
  v_person public.persons%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_record public.ocr_records%ROWTYPE;
  v_previous public.crm_ocr_parse_commands%ROWTYPE;
  v_command public.crm_ocr_parse_commands%ROWTYPE;
  v_current jsonb;
  v_before jsonb;
  v_after jsonb;
  v_keys text[];
  v_now timestamptz:=clock_timestamp();
BEGIN
  IF current_user<>'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_idempotency_key IS NULL OR
     p_person_id IS NULL OR p_person_id<1 OR p_customer_id IS NULL OR p_customer_id<1 OR
     p_ocr_record_id IS NULL OR p_ocr_record_id<1 OR
     jsonb_typeof(p_selected) IS DISTINCT FROM 'object' OR length(p_selected::text)>10000 THEN
    RAISE EXCEPTION 'Invalid OCR parse preview' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_selected) k WHERE k NOT IN
    ('phone','gender','birthday','occupation','education','marital_status','customer_stage',
     'sales_priority','referral_priority','hobbies','source','additional_info')) OR
     EXISTS (SELECT 1 FROM jsonb_each(p_selected) e
       WHERE jsonb_typeof(e.value)<>'string' OR length(btrim(e.value #>> '{}'))=0 OR
         length(e.value #>> '{}')>CASE e.key WHEN 'additional_info' THEN 8000
           WHEN 'occupation' THEN 200 WHEN 'education' THEN 120 WHEN 'gender' THEN 32
           WHEN 'customer_stage' THEN 32 WHEN 'sales_priority' THEN 1 WHEN 'referral_priority' THEN 1
           WHEN 'birthday' THEN 10 ELSE 500 END) OR
     cardinality(ARRAY(SELECT jsonb_object_keys(p_selected)))=0 THEN
    RAISE EXCEPTION 'OCR fields are empty, invalid, or outside the approved field scope' USING ERRCODE='22023';
  END IF;
  IF p_selected ? 'birthday' AND (p_selected->>'birthday') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Invalid OCR birthday' USING ERRCODE='22023';
  END IF;
  IF p_selected ? 'gender' AND p_selected->>'gender' NOT IN ('男','女','未知') THEN
    RAISE EXCEPTION 'Invalid OCR gender' USING ERRCODE='22023';
  END IF;
  IF p_selected ? 'sales_priority' AND p_selected->>'sales_priority' NOT IN ('A','B','C','D','E') THEN
    RAISE EXCEPTION 'Invalid OCR sales priority' USING ERRCODE='22023';
  END IF;
  IF p_selected ? 'referral_priority' AND p_selected->>'referral_priority' NOT IN ('A','B','C','D','E') THEN
    RAISE EXCEPTION 'Invalid OCR referral priority' USING ERRCODE='22023';
  END IF;
  IF p_selected ? 'customer_stage' AND p_selected->>'customer_stage' NOT IN
    ('新认识','关系维护','需求挖掘','方案沟通','成交推进','转介绍经营') THEN
    RAISE EXCEPTION 'Invalid OCR customer stage' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_previous FROM public.crm_ocr_parse_commands
    WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_previous.person_id<>p_person_id OR v_previous.customer_id<>p_customer_id OR
       v_previous.ocr_record_id<>p_ocr_record_id OR v_previous.operation<>'apply' OR
       v_previous.payload<>p_selected THEN
      RAISE EXCEPTION 'OCR preview idempotency key reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('previewId',v_previous.id,'preview',v_previous.preview,
      'expiresAt',v_previous.expires_at,'status',v_previous.status,'result',v_previous.result,
      'replayed',true,'businessDataWritten',false);
  END IF;
  SELECT * INTO v_person FROM public.persons WHERE id=p_person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OCR Person is missing or deleted' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_customer FROM public.customers
    WHERE "Id"=p_customer_id AND person_id=p_person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OCR customer does not belong to the selected Person' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_record FROM public.ocr_records
    WHERE id=p_ocr_record_id AND customer_id=p_customer_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'OCR source record is missing or deleted' USING ERRCODE='40001'; END IF;

  v_keys:=ARRAY(SELECT jsonb_object_keys(p_selected) ORDER BY 1);
  v_current:=jsonb_build_object(
    'phone',v_person.phone,'gender',v_person.gender,'birthday',v_person.birthday,
    'occupation',v_person.occupation,'education',v_person.education,
    'marital_status',v_person.marital_status,'customer_stage',v_person.customer_stage,
    'sales_priority',v_person.sales_priority,'referral_priority',v_person.referral_priority,
    'hobbies',v_person.hobbies,'source',v_person.source,'additional_info',v_customer.additional_info);
  SELECT coalesce(jsonb_object_agg(k,v_current->k),'{}'::jsonb) INTO v_before FROM unnest(v_keys) k;
  v_after:=p_selected;
  IF v_before=v_after THEN RAISE EXCEPTION 'OCR selection would not change any field' USING ERRCODE='22023'; END IF;
  INSERT INTO public.crm_ocr_parse_commands(actor_uid,idempotency_key,person_id,customer_id,
      ocr_record_id,operation,payload,selected_fields,before_state,after_state,preview)
    VALUES(p_actor_uid,p_idempotency_key,p_person_id,p_customer_id,p_ocr_record_id,'apply',
      p_selected,v_keys,v_before,v_after,jsonb_build_object('personId',p_person_id,
        'customerId',p_customer_id,'ocrRecordId',p_ocr_record_id,'operation','apply',
        'before',v_before,'after',v_after,'fields',to_jsonb(v_keys),'expiresAt',v_now+interval '15 minutes'))
    ON CONFLICT(actor_uid,idempotency_key) DO NOTHING RETURNING * INTO v_command;
  IF NOT FOUND THEN
    SELECT * INTO v_command FROM public.crm_ocr_parse_commands
      WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
    IF v_command.person_id<>p_person_id OR v_command.customer_id<>p_customer_id OR
       v_command.ocr_record_id<>p_ocr_record_id OR v_command.operation<>'apply' OR
       v_command.payload<>p_selected THEN RAISE EXCEPTION 'OCR preview idempotency key reused' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN jsonb_build_object('previewId',v_command.id,'preview',v_command.preview,
    'expiresAt',v_command.expires_at,'status',v_command.status,
    'replayed',false,'businessDataWritten',false);
END $preview$;

CREATE FUNCTION public.crm_ocr_parse_undo_preview_v1(
  p_actor_uid text,p_idempotency_key uuid,p_applied_command_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $undo_preview$
DECLARE
  v_parent public.crm_ocr_parse_commands%ROWTYPE;
  v_previous public.crm_ocr_parse_commands%ROWTYPE;
  v_command public.crm_ocr_parse_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_record public.ocr_records%ROWTYPE;
  v_current jsonb;
  v_now timestamptz:=clock_timestamp();
BEGIN
  IF current_user<>'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_idempotency_key IS NULL OR
     p_applied_command_id IS NULL THEN
    RAISE EXCEPTION 'Invalid OCR undo preview' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_previous FROM public.crm_ocr_parse_commands
    WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_previous.operation<>'undo' OR v_previous.parent_command_id<>p_applied_command_id THEN
      RAISE EXCEPTION 'OCR undo idempotency key reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('previewId',v_previous.id,'preview',v_previous.preview,
      'expiresAt',v_previous.expires_at,'status',v_previous.status,'result',v_previous.result,
      'replayed',true,'businessDataWritten',false);
  END IF;
  SELECT * INTO v_parent FROM public.crm_ocr_parse_commands
    WHERE id=p_applied_command_id AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND OR v_parent.operation<>'apply' OR v_parent.status<>'executed' OR
     v_parent.reversed_by_command_id IS NOT NULL THEN
    RAISE EXCEPTION 'OCR apply command is unavailable for undo' USING ERRCODE='40001';
  END IF;
  SELECT * INTO v_person FROM public.persons WHERE id=v_parent.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OCR Person is missing or deleted' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_customer FROM public.customers WHERE "Id"=v_parent.customer_id
    AND person_id=v_parent.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OCR customer mapping changed or was deleted' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_record FROM public.ocr_records WHERE id=v_parent.ocr_record_id
    AND customer_id=v_parent.customer_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'OCR source record is missing or deleted' USING ERRCODE='40001'; END IF;
  v_current:=jsonb_build_object(
    'phone',v_person.phone,'gender',v_person.gender,'birthday',v_person.birthday,
    'occupation',v_person.occupation,'education',v_person.education,
    'marital_status',v_person.marital_status,'customer_stage',v_person.customer_stage,
    'sales_priority',v_person.sales_priority,'referral_priority',v_person.referral_priority,
    'hobbies',v_person.hobbies,'source',v_person.source,'additional_info',v_customer.additional_info);
  IF (SELECT coalesce(jsonb_object_agg(k,v_current->k),'{}'::jsonb)
      FROM unnest(v_parent.selected_fields) k) IS DISTINCT FROM v_parent.after_state THEN
    RAISE EXCEPTION 'OCR undo conflict: one or more fields changed after parsing; refresh and review' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.crm_ocr_parse_commands(actor_uid,idempotency_key,person_id,customer_id,
      ocr_record_id,operation,parent_command_id,payload,selected_fields,before_state,after_state,preview)
    VALUES(p_actor_uid,p_idempotency_key,v_parent.person_id,v_parent.customer_id,
      v_parent.ocr_record_id,'undo',v_parent.id,v_parent.before_state,v_parent.selected_fields,
      v_parent.after_state,v_parent.before_state,jsonb_build_object('personId',v_parent.person_id,
        'customerId',v_parent.customer_id,'ocrRecordId',v_parent.ocr_record_id,
        'operation','undo','sourceCommandId',v_parent.id,'before',v_parent.after_state,
        'after',v_parent.before_state,'fields',to_jsonb(v_parent.selected_fields),
        'expiresAt',v_now+interval '15 minutes'))
    ON CONFLICT(actor_uid,idempotency_key) DO NOTHING RETURNING * INTO v_command;
  IF NOT FOUND THEN
    SELECT * INTO v_command FROM public.crm_ocr_parse_commands
      WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
    IF v_command.operation<>'undo' OR v_command.parent_command_id<>p_applied_command_id THEN
      RAISE EXCEPTION 'OCR undo idempotency key reused' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN jsonb_build_object('previewId',v_command.id,'preview',v_command.preview,
    'expiresAt',v_command.expires_at,'status',v_command.status,
    'replayed',false,'businessDataWritten',false);
END $undo_preview$;

CREATE FUNCTION public.crm_ocr_parse_execute_v1(p_actor_uid text,p_preview_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $execute$
DECLARE
  v_command public.crm_ocr_parse_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_record public.ocr_records%ROWTYPE;
  v_current jsonb;
  v_now timestamptz:=clock_timestamp();
  v_result jsonb;
  v_key text;
BEGIN
  IF current_user<>'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_preview_id IS NULL THEN
    RAISE EXCEPTION 'Invalid OCR execution' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_command FROM public.crm_ocr_parse_commands
    WHERE id=p_preview_id AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OCR preview not found for account' USING ERRCODE='42501'; END IF;
  IF v_command.status='executed' OR v_command.status='undone' THEN
    RETURN v_command.result || jsonb_build_object('replayed',true);
  END IF;
  IF v_command.status<>'preview' OR v_command.expires_at<=v_now THEN
    UPDATE public.crm_ocr_parse_commands SET status='expired' WHERE id=v_command.id AND status='preview';
    RAISE EXCEPTION 'OCR preview expired; refresh and preview again' USING ERRCODE='40001';
  END IF;
  SELECT * INTO v_person FROM public.persons WHERE id=v_command.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OCR Person is missing or deleted' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_customer FROM public.customers WHERE "Id"=v_command.customer_id
    AND person_id=v_command.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OCR customer mapping changed or was deleted' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_record FROM public.ocr_records WHERE id=v_command.ocr_record_id
    AND customer_id=v_command.customer_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OCR source record is missing or deleted' USING ERRCODE='40001'; END IF;
  v_current:=jsonb_build_object(
    'phone',v_person.phone,'gender',v_person.gender,'birthday',v_person.birthday,
    'occupation',v_person.occupation,'education',v_person.education,
    'marital_status',v_person.marital_status,'customer_stage',v_person.customer_stage,
    'sales_priority',v_person.sales_priority,'referral_priority',v_person.referral_priority,
    'hobbies',v_person.hobbies,'source',v_person.source,'additional_info',v_customer.additional_info);
  IF (SELECT coalesce(jsonb_object_agg(k,v_current->k),'{}'::jsonb)
      FROM unnest(v_command.selected_fields) k) IS DISTINCT FROM v_command.before_state THEN
    RAISE EXCEPTION 'OCR fields changed after preview; refresh and review' USING ERRCODE='40001';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_command.selected_fields) field WHERE field<>'additional_info') THEN
    UPDATE public.persons SET
      phone=CASE WHEN v_command.payload?'phone' THEN v_command.payload->>'phone' ELSE phone END,
      gender=CASE WHEN v_command.payload?'gender' THEN v_command.payload->>'gender' ELSE gender END,
      birthday=CASE WHEN v_command.payload?'birthday' THEN (v_command.payload->>'birthday')::date ELSE birthday END,
      occupation=CASE WHEN v_command.payload?'occupation' THEN v_command.payload->>'occupation' ELSE occupation END,
      education=CASE WHEN v_command.payload?'education' THEN v_command.payload->>'education' ELSE education END,
      marital_status=CASE WHEN v_command.payload?'marital_status' THEN v_command.payload->>'marital_status' ELSE marital_status END,
      customer_stage=CASE WHEN v_command.payload?'customer_stage' THEN (v_command.payload->>'customer_stage')::public."客户经营阶段" ELSE customer_stage END,
      sales_priority=CASE WHEN v_command.payload?'sales_priority' THEN (v_command.payload->>'sales_priority')::public."优先级" ELSE sales_priority END,
      referral_priority=CASE WHEN v_command.payload?'referral_priority' THEN (v_command.payload->>'referral_priority')::public."优先级" ELSE referral_priority END,
      hobbies=CASE WHEN v_command.payload?'hobbies' THEN v_command.payload->>'hobbies' ELSE hobbies END,
      source=CASE WHEN v_command.payload?'source' THEN v_command.payload->>'source' ELSE source END,
      updated_at=v_now
    WHERE id=v_command.person_id;
  END IF;
  IF v_command.payload?'additional_info' THEN
    UPDATE public.customers SET additional_info=v_command.payload->>'additional_info',updated_at=v_now
      WHERE "Id"=v_command.customer_id AND person_id=v_command.person_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'OCR customer mapping changed during execution' USING ERRCODE='40001'; END IF;
  END IF;
  IF v_command.operation='undo' THEN
    UPDATE public.crm_ocr_parse_commands SET status='undone',reversed_by_command_id=v_command.id
      WHERE id=v_command.parent_command_id AND status='executed' AND reversed_by_command_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'OCR source command is no longer undoable' USING ERRCODE='40001'; END IF;
  END IF;
  v_result:=jsonb_build_object('ok',true,'operation',v_command.operation,
    'personId',v_command.person_id,'customerId',v_command.customer_id,
    'ocrRecordId',v_command.ocr_record_id,'commandId',v_command.id,
    'sourceCommandId',v_command.parent_command_id,'fields',to_jsonb(v_command.selected_fields),
    'executedAt',v_now,'replayed',false);
  UPDATE public.crm_ocr_parse_commands SET status='executed',executed_at=v_now,result=v_result
    WHERE id=v_command.id;
  RETURN v_result;
END $execute$;

REVOKE ALL ON FUNCTION public.crm_ocr_parse_preview_v1(text,uuid,bigint,integer,bigint,jsonb)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_ocr_parse_undo_preview_v1(text,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.crm_ocr_parse_execute_v1(text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_ocr_parse_preview_v1(text,uuid,bigint,integer,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_ocr_parse_undo_preview_v1(text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_ocr_parse_execute_v1(text,uuid) TO service_role;

COMMIT;
