-- PC07: append-only review commands for Person context items.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF to_regclass('public.crm_context_item_commands') IS NOT NULL OR
     to_regprocedure('public.crm_context_item_preview_v1(text,uuid,bigint,bigint,text,jsonb)') IS NOT NULL OR
     to_regprocedure('public.crm_context_item_execute_v1(text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'PC07 context lifecycle objects already exist; inspect before migrating';
  END IF;
END $guard$;

CREATE TABLE public.crm_context_item_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  idempotency_key uuid NOT NULL,
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  item_id bigint NOT NULL REFERENCES public.context_items(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('confirm','correct','expire','withdraw','promote')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  before_state jsonb NOT NULL,
  preview jsonb NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','executed')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  UNIQUE (actor_uid, idempotency_key)
);
CREATE INDEX crm_context_item_commands_actor_idx
  ON public.crm_context_item_commands(actor_uid, created_at DESC);
CREATE INDEX crm_context_item_commands_item_idx
  ON public.crm_context_item_commands(item_id, created_at DESC);
ALTER TABLE public.crm_context_item_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_context_item_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_context_item_commands_service_only ON public.crm_context_item_commands
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.crm_context_item_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_context_item_commands TO service_role;
GRANT UPDATE (confirmed, confirmed_by_uid, confirmed_at, valid_to, last_verified_at)
  ON public.context_items TO service_role;

CREATE FUNCTION public.crm_context_item_preview_v1(
  p_actor_uid text, p_idempotency_key uuid, p_person_id bigint,
  p_item_id bigint, p_operation text, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $preview$
DECLARE
  v_person public.persons%ROWTYPE;
  v_item public.context_items%ROWTYPE;
  v_previous public.crm_context_item_commands%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_command public.crm_context_item_commands%ROWTYPE;
  v_interaction public.interactions%ROWTYPE;
  v_origin public.context_items%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_source jsonb;
BEGIN
  IF current_user <> 'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_idempotency_key IS NULL OR
     p_person_id IS NULL OR p_person_id < 1 OR p_item_id IS NULL OR p_item_id < 1 OR
     p_operation NOT IN ('confirm','correct','expire','withdraw','promote') OR
     jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR length(p_payload::text) > 6000 THEN
    RAISE EXCEPTION 'Invalid context item command' USING ERRCODE = '22023';
  END IF;
  IF (p_operation IN ('correct','promote') AND
      (EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('content','category')) OR
       NOT (p_payload ? 'content' AND p_payload ? 'category') OR
       jsonb_typeof(p_payload->'content') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_payload->'category') IS DISTINCT FROM 'string' OR
       length(btrim(p_payload->>'content')) NOT BETWEEN 1 AND 4000 OR
       length(btrim(p_payload->>'category')) NOT BETWEEN 1 AND 64)) OR
     (p_operation NOT IN ('correct','promote') AND p_payload <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'Invalid context item draft' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_previous FROM public.crm_context_item_commands
    WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_previous.person_id<>p_person_id OR v_previous.item_id<>p_item_id OR
       v_previous.operation<>p_operation OR v_previous.payload<>p_payload THEN
      RAISE EXCEPTION 'Context item idempotency key reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('previewId',v_previous.id,'preview',v_previous.preview,
      'expiresAt',v_previous.expires_at,'status',v_previous.status,
      'result',v_previous.result,'replayed',true,'businessDataWritten',false);
  END IF;
  SELECT * INTO v_person FROM public.persons
    WHERE id=p_person_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Context item Person unavailable' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
     (position('【系统测试·勿联系】' IN v_person.display_name)=0 OR
      NOT EXISTS (SELECT 1 FROM public.crm_test_records AS person_record
        JOIN public.crm_test_batches AS batch ON batch.batch_key=person_record.batch_key
        WHERE batch.created_by_uid=p_actor_uid AND person_record.record_table='persons'
          AND person_record.record_id=p_person_id::text)) THEN
    RAISE EXCEPTION 'Test account requires tracked fictional Person' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_item FROM public.context_items
    WHERE id=p_item_id AND person_id=p_person_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Context item not found for Person' USING ERRCODE='22023'; END IF;
  IF v_item.interaction_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.interactions i WHERE i.id=v_item.interaction_id AND i.person_id=p_person_id) THEN
    RAISE EXCEPTION 'Context item source is unavailable' USING ERRCODE='40001';
  END IF;
  IF v_item.interaction_id IS NOT NULL THEN
    SELECT * INTO v_interaction FROM public.interactions
      WHERE id=v_item.interaction_id AND person_id=p_person_id;
    v_source := jsonb_build_object('type',v_interaction.interaction_type,
      'at',v_interaction.interaction_at,'channel',v_interaction.channel,
      'summary',left(v_interaction.summary,1000),'rawNote',left(v_interaction.raw_note,2000));
  ELSIF v_item.source_type='context_items' THEN
    SELECT * INTO v_origin FROM public.context_items
      WHERE id=v_item.source_id AND person_id=p_person_id;
    v_source := jsonb_build_object('type','context_item','id',v_origin.id,
      'category',v_origin.category,'content',left(v_origin.content,1000),
      'sourceType',v_origin.source_type,'sourceId',v_origin.source_id);
  ELSE
    v_source := jsonb_build_object('type',v_item.source_type,'id',v_item.source_id);
  END IF;
  IF v_item.source_type='context_items' AND NOT EXISTS (
      SELECT 1 FROM public.context_items origin WHERE origin.id=v_item.source_id
        AND origin.person_id=p_person_id) THEN
    RAISE EXCEPTION 'Context item source is unavailable' USING ERRCODE='40001';
  END IF;
  IF (v_item.valid_from IS NOT NULL AND v_item.valid_from>v_now) OR
     (v_item.valid_to IS NOT NULL AND v_item.valid_to<v_now) OR
     (p_operation='confirm' AND (v_item.item_type<>'fact' OR v_item.confirmed)) OR
     (p_operation='correct' AND v_item.item_type<>'fact') OR
     (p_operation='promote' AND v_item.item_type NOT IN ('signal','inference')) THEN
    RAISE EXCEPTION 'Context item state changed; refresh' USING ERRCODE='40001';
  END IF;
  v_before := jsonb_build_object('id',v_item.id,'personId',v_item.person_id,
    'interactionId',v_item.interaction_id,'type',v_item.item_type,'category',v_item.category,
    'content',v_item.content,'structuredValue',v_item.structured_value,
    'sourceType',v_item.source_type,'sourceId',v_item.source_id,'confidence',v_item.confidence,
    'confirmed',v_item.confirmed,'confirmedAt',v_item.confirmed_at,
    'validFrom',v_item.valid_from,'validTo',v_item.valid_to,
    'lastVerifiedAt',v_item.last_verified_at,'createdAt',v_item.created_at);
  v_after := CASE p_operation
    WHEN 'confirm' THEN jsonb_build_object('type','fact','confirmed',true,'confirmedBy',p_actor_uid,'validTo',v_item.valid_to)
    WHEN 'correct' THEN jsonb_build_object('type','fact','category',btrim(p_payload->>'category'),
      'content',btrim(p_payload->>'content'),'confirmed',true,'supersedes',v_item.id)
    WHEN 'promote' THEN jsonb_build_object('type','fact','category',btrim(p_payload->>'category'),
      'content',btrim(p_payload->>'content'),'confirmed',true,'derivedFrom',v_item.id)
    WHEN 'expire' THEN jsonb_build_object('type',v_item.item_type,'validTo',v_now,'lifecycle','expired')
    ELSE jsonb_build_object('type',v_item.item_type,'validTo',v_now,'lifecycle','withdrawn') END;
  INSERT INTO public.crm_context_item_commands(actor_uid,idempotency_key,person_id,item_id,
      operation,payload,before_state,preview)
    VALUES(p_actor_uid,p_idempotency_key,p_person_id,p_item_id,p_operation,p_payload,v_before,
      jsonb_build_object('personId',p_person_id,'personName',v_person.display_name,
        'operation',p_operation,'before',v_before,'after',v_after,
        'source',jsonb_build_object('sourceType',v_item.source_type,'sourceId',v_item.source_id,
          'interactionId',v_item.interaction_id,'evidence',v_source)))
    ON CONFLICT(actor_uid,idempotency_key) DO NOTHING RETURNING * INTO v_command;
  IF NOT FOUND THEN
    SELECT * INTO v_command FROM public.crm_context_item_commands
      WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
    IF v_command.person_id<>p_person_id OR v_command.item_id<>p_item_id OR
       v_command.operation<>p_operation OR v_command.payload<>p_payload THEN
      RAISE EXCEPTION 'Context item idempotency key reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('previewId',v_command.id,'preview',v_command.preview,
      'expiresAt',v_command.expires_at,'status',v_command.status,
      'result',v_command.result,'replayed',true,'businessDataWritten',false);
  END IF;
  RETURN jsonb_build_object('previewId',v_command.id,'preview',v_command.preview,
    'expiresAt',v_command.expires_at,'status','preview','businessDataWritten',false);
END $preview$;

CREATE FUNCTION public.crm_context_item_execute_v1(p_actor_uid text,p_preview_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $execute$
DECLARE
  v_command public.crm_context_item_commands%ROWTYPE;
  v_item public.context_items%ROWTYPE;
  v_new_id bigint;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  IF current_user <> 'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_preview_id IS NULL THEN
    RAISE EXCEPTION 'Invalid context item execution' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_command FROM public.crm_context_item_commands
    WHERE id=p_preview_id AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Context item preview not found for account' USING ERRCODE='42501'; END IF;
  IF v_command.status='executed' THEN RETURN v_command.result || jsonb_build_object('replayed',true); END IF;
  IF v_command.expires_at<=v_now THEN RAISE EXCEPTION 'Context item preview expired' USING ERRCODE='40001'; END IF;
  PERFORM 1 FROM public.persons WHERE id=v_command.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Context item Person unavailable' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_item FROM public.context_items
    WHERE id=v_command.item_id AND person_id=v_command.person_id FOR UPDATE;
  IF NOT FOUND OR jsonb_build_object('id',v_item.id,'personId',v_item.person_id,
      'interactionId',v_item.interaction_id,'type',v_item.item_type,'category',v_item.category,
      'content',v_item.content,'structuredValue',v_item.structured_value,
      'sourceType',v_item.source_type,'sourceId',v_item.source_id,'confidence',v_item.confidence,
      'confirmed',v_item.confirmed,'confirmedAt',v_item.confirmed_at,
      'validFrom',v_item.valid_from,'validTo',v_item.valid_to,
      'lastVerifiedAt',v_item.last_verified_at,'createdAt',v_item.created_at)
      IS DISTINCT FROM v_command.before_state THEN
    RAISE EXCEPTION 'Context item changed; refresh and preview again' USING ERRCODE='40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) AND
     NOT EXISTS (SELECT 1 FROM public.crm_test_records AS item_record
       JOIN public.crm_test_batches AS batch ON batch.batch_key=item_record.batch_key
       WHERE batch.created_by_uid=p_actor_uid AND item_record.record_table='context_items'
         AND item_record.record_id=v_item.id::text) THEN
    RAISE EXCEPTION 'Test account requires tracked fictional context item' USING ERRCODE='42501';
  END IF;
  IF (v_item.valid_from IS NOT NULL AND v_item.valid_from>v_now) OR
     (v_item.valid_to IS NOT NULL AND v_item.valid_to<v_now) THEN
    RAISE EXCEPTION 'Context item is no longer current; refresh' USING ERRCODE='40001';
  END IF;
  IF v_item.interaction_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.interactions i WHERE i.id=v_item.interaction_id AND i.person_id=v_command.person_id) THEN
    RAISE EXCEPTION 'Context item source is unavailable' USING ERRCODE='40001';
  END IF;
  CASE v_command.operation
    WHEN 'confirm' THEN
      UPDATE public.context_items SET confirmed=true,confirmed_by_uid=p_actor_uid,
        confirmed_at=v_now,last_verified_at=v_now WHERE id=v_item.id;
    WHEN 'correct' THEN
      UPDATE public.context_items SET valid_to=v_now,last_verified_at=v_now WHERE id=v_item.id;
      INSERT INTO public.context_items(person_id,interaction_id,item_type,category,content,
        structured_value,source_type,source_id,confidence,confirmed,confirmed_by_uid,confirmed_at,
        valid_from,last_verified_at)
      VALUES(v_item.person_id,v_item.interaction_id,'fact',v_command.payload->>'category',
        v_command.payload->>'content',v_item.structured_value,'context_items',v_item.id,
        v_item.confidence,true,p_actor_uid,v_now,v_now,v_now) RETURNING id INTO v_new_id;
    WHEN 'promote' THEN
      UPDATE public.context_items SET valid_to=v_now,last_verified_at=v_now WHERE id=v_item.id;
      INSERT INTO public.context_items(person_id,interaction_id,item_type,category,content,
        structured_value,source_type,source_id,confidence,confirmed,confirmed_by_uid,confirmed_at,
        valid_from,last_verified_at)
      VALUES(v_item.person_id,v_item.interaction_id,'fact',v_command.payload->>'category',
        v_command.payload->>'content',v_item.structured_value,'context_items',v_item.id,
        v_item.confidence,true,p_actor_uid,v_now,v_now,v_now) RETURNING id INTO v_new_id;
    WHEN 'expire' THEN
      UPDATE public.context_items SET valid_to=v_now,last_verified_at=v_now WHERE id=v_item.id;
    WHEN 'withdraw' THEN
      UPDATE public.context_items SET valid_to=v_now,last_verified_at=v_now WHERE id=v_item.id;
  END CASE;
  v_result := jsonb_build_object('ok',true,'operation',v_command.operation,
    'personId',v_command.person_id,'itemId',v_command.item_id,'newItemId',v_new_id,
    'executedAt',v_now,'replayed',false);
  UPDATE public.crm_context_item_commands SET status='executed',executed_at=v_now,result=v_result
    WHERE id=v_command.id;
  RETURN v_result;
END $execute$;

REVOKE ALL ON FUNCTION public.crm_context_item_preview_v1(text,uuid,bigint,bigint,text,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_context_item_execute_v1(text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_context_item_preview_v1(text,uuid,bigint,bigint,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_context_item_execute_v1(text,uuid) TO service_role;
COMMENT ON TABLE public.crm_context_item_commands IS
  'PC07 append-only preview/execution and before/after audit for human-reviewed Person context lifecycle commands';
COMMENT ON FUNCTION public.crm_context_item_preview_v1(text,uuid,bigint,bigint,text,jsonb) IS
  'PC07 server-validated preview. No business rows are changed until matching execute.';
COMMENT ON FUNCTION public.crm_context_item_execute_v1(text,uuid) IS
  'PC07 atomic, actor-bound, version-checked execution; only service_role may invoke.';
COMMIT;
