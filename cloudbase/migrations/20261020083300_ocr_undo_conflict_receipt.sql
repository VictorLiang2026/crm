-- PC36 E08: keep the existing public OCR undo preview transaction and return a fixed receipt for only the two known field/version conflicts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
  IF to_regprocedure('public.crm_ocr_parse_undo_preview_v1(text,uuid,uuid)') IS NULL OR
     position('OCR undo conflict: one or more fields changed after parsing' in
       pg_catalog.pg_get_functiondef('public.crm_ocr_parse_undo_preview_v1(text,uuid,uuid)'::pg_catalog.regprocedure))=0 OR
     position('OCR undo conflict: profile version changed after parsing' in
       pg_catalog.pg_get_functiondef('public.crm_ocr_parse_undo_preview_v1(text,uuid,uuid)'::pg_catalog.regprocedure))=0 THEN
    RAISE EXCEPTION 'OCR undo preview baseline changed; stop migration';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.crm_ocr_parse_undo_preview_v1(
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
    RETURN jsonb_build_object('errorCode','OCR_UNDO_CONFLICT','businessDataWritten',false);
  END IF;
  IF (v_parent.result->'rowVersionsAfter'->>'person') IS NOT NULL AND
       (v_parent.result->'rowVersionsAfter'->>'person')::timestamptz IS DISTINCT FROM v_person.updated_at OR
     (v_parent.result->'rowVersionsAfter'->>'customer') IS NOT NULL AND
       (v_parent.result->'rowVersionsAfter'->>'customer')::timestamptz IS DISTINCT FROM v_customer.updated_at THEN
    RETURN jsonb_build_object('errorCode','OCR_UNDO_CONFLICT','businessDataWritten',false);
  END IF;
  INSERT INTO public.crm_ocr_parse_commands(actor_uid,idempotency_key,person_id,customer_id,
      ocr_record_id,operation,parent_command_id,payload,selected_fields,before_state,after_state,preview)
    VALUES(p_actor_uid,p_idempotency_key,v_parent.person_id,v_parent.customer_id,
      v_parent.ocr_record_id,'undo',v_parent.id,v_parent.before_state,v_parent.selected_fields,
      v_parent.after_state,v_parent.before_state,jsonb_build_object('personId',v_parent.person_id,
        'customerId',v_parent.customer_id,'ocrRecordId',v_parent.ocr_record_id,
        'operation','undo','sourceCommandId',v_parent.id,'before',v_parent.after_state,'after',v_parent.before_state,
        'rowVersionsBefore',jsonb_build_object(
          'person',CASE WHEN EXISTS (SELECT 1 FROM unnest(v_parent.selected_fields) f WHERE f<>'additional_info') THEN v_person.updated_at END,
          'customer',CASE WHEN 'additional_info'=ANY(v_parent.selected_fields) THEN v_customer.updated_at END),
        'fields',to_jsonb(v_parent.selected_fields),
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

COMMIT;
