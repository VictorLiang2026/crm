-- PC27: actor-bound Assistant confirmation over Person-only Opportunity commands.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.assistant_opportunity_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  idempotency_key uuid NOT NULL,
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  opportunity_id bigint NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('edit','stage','close')),
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  upstream_idempotency_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  upstream_preview_id uuid UNIQUE REFERENCES public.crm_opportunity_commands(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','previewed','confirmed','executed')),
  preview jsonb,
  preview_hash text,
  person_updated_at timestamptz,
  opportunity_updated_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  confirmed_by_uid text,
  confirmed_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_uid,idempotency_key),
  CHECK ((status IN ('planned','previewed') AND confirmed_by_uid IS NULL AND confirmed_at IS NULL)
      OR (status IN ('confirmed','executed') AND confirmed_by_uid = actor_uid AND confirmed_at IS NOT NULL)),
  CHECK ((operation = 'edit' AND upstream_preview_id IS NULL) OR
      (operation IN ('stage','close') AND (status = 'planned' OR upstream_preview_id IS NOT NULL)))
);
CREATE INDEX assistant_opportunity_commands_actor_idx
  ON public.assistant_opportunity_commands(actor_uid,created_at DESC);
CREATE INDEX assistant_opportunity_commands_expiry_idx
  ON public.assistant_opportunity_commands(expires_at) WHERE status <> 'executed';
ALTER TABLE public.assistant_opportunity_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_opportunity_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_opportunity_commands_service_only
  ON public.assistant_opportunity_commands FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.assistant_opportunity_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.assistant_opportunity_commands TO service_role;

CREATE FUNCTION public.assistant_opportunity_command_v1(
  p_stage text,p_actor_uid text,p_command_id uuid DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,p_person_id bigint DEFAULT NULL,
  p_opportunity_id bigint DEFAULT NULL,p_operation text DEFAULT NULL,
  p_draft jsonb DEFAULT NULL,p_preview_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $function$
DECLARE
  v_cmd public.assistant_opportunity_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_opp public.opportunities%ROWTYPE;
  v_upstream public.crm_opportunity_commands%ROWTYPE;
  v_upstream_result jsonb;
  v_preview jsonb;
  v_after jsonb;
  v_payload jsonb;
  v_hash text;
  v_expiry timestamptz;
  v_result jsonb;
  v_test_account boolean;
BEGIN
  IF current_user <> 'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR
     p_stage NOT IN ('plan','preview','confirm','execute') OR p_stage IS NULL THEN
    RAISE EXCEPTION 'Invalid Assistant Opportunity command' USING ERRCODE='22023';
  END IF;

  IF p_stage='plan' THEN
    IF p_command_id IS NOT NULL OR p_preview_hash IS NOT NULL OR
       p_idempotency_key IS NULL OR p_person_id IS NULL OR p_person_id<1 OR
       p_opportunity_id IS NULL OR p_opportunity_id<1 OR
       p_operation NOT IN ('edit','stage','close') OR p_operation IS NULL OR
       jsonb_typeof(p_draft) IS DISTINCT FROM 'object' OR length(p_draft::text)>12000 THEN
      RAISE EXCEPTION 'Invalid Opportunity plan' USING ERRCODE='22023';
    END IF;
    IF p_operation='edit' THEN
      IF jsonb_object_length(p_draft)<1 OR jsonb_object_length(p_draft)>4 OR
         EXISTS (SELECT 1 FROM jsonb_object_keys(p_draft) k
           WHERE k NOT IN ('type','progress','nextAction','nextActionDate')) OR
         (p_draft ? 'type' AND (jsonb_typeof(p_draft->'type') IS DISTINCT FROM 'string' OR
           p_draft->>'type' NOT IN ('insurance','recruit','referral','activity','speaker',
             'partnership','service','relationship'))) OR
         (p_draft ? 'progress' AND (jsonb_typeof(p_draft->'progress') IS DISTINCT FROM 'string' OR
           length(p_draft->>'progress')>4000)) OR
         (p_draft ? 'nextAction' AND (jsonb_typeof(p_draft->'nextAction') IS DISTINCT FROM 'string' OR
           length(p_draft->>'nextAction')>1000)) OR
         (p_draft ? 'nextActionDate' AND jsonb_typeof(p_draft->'nextActionDate') NOT IN ('string','null')) THEN
        RAISE EXCEPTION 'Invalid Opportunity edit fields' USING ERRCODE='22023';
      END IF;
      IF p_draft ? 'nextActionDate' AND p_draft->'nextActionDate'<>'null'::jsonb THEN
        IF p_draft->>'nextActionDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          RAISE EXCEPTION 'Invalid Opportunity date' USING ERRCODE='22023';
        END IF;
        PERFORM (p_draft->>'nextActionDate')::date;
      END IF;
    ELSIF p_operation='stage' THEN
      IF jsonb_object_length(p_draft)<>1 OR NOT (p_draft ? 'status') OR
         jsonb_typeof(p_draft->'status') IS DISTINCT FROM 'string' OR
         p_draft->>'status' NOT IN ('发现','沟通','方案','潜在线索','已介绍','已联系','已建立关系') THEN
        RAISE EXCEPTION 'Invalid Opportunity stage' USING ERRCODE='22023';
      END IF;
    ELSE
      IF jsonb_object_length(p_draft)<>2 OR NOT (p_draft ? 'status' AND p_draft ? 'result') OR
         jsonb_typeof(p_draft->'status') IS DISTINCT FROM 'string' OR
         p_draft->>'status' NOT IN ('成交','关闭') OR
         jsonb_typeof(p_draft->'result') IS DISTINCT FROM 'string' OR
         length(btrim(p_draft->>'result')) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION 'Invalid Opportunity close result' USING ERRCODE='22023';
      END IF;
    END IF;
    SELECT * INTO v_cmd FROM public.assistant_opportunity_commands
      WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
    IF FOUND THEN
      IF v_cmd.person_id<>p_person_id OR v_cmd.opportunity_id<>p_opportunity_id OR
         v_cmd.operation<>p_operation OR v_cmd.draft<>p_draft THEN
        RAISE EXCEPTION 'Opportunity idempotency key reused' USING ERRCODE='22023';
      END IF;
      RETURN jsonb_build_object('ok',true,'status',v_cmd.status,'commandId',v_cmd.id,
        'expiresAt',v_cmd.expires_at,'replayed',true,'businessDataWritten',false);
    END IF;
    INSERT INTO public.assistant_opportunity_commands(actor_uid,idempotency_key,person_id,
      opportunity_id,operation,draft)
    VALUES(p_actor_uid,p_idempotency_key,p_person_id,p_opportunity_id,p_operation,p_draft)
    RETURNING * INTO v_cmd;
    RETURN jsonb_build_object('ok',true,'status','planned','commandId',v_cmd.id,
      'expiresAt',v_cmd.expires_at,'nextStep','preview','businessDataWritten',false);
  END IF;

  IF p_command_id IS NULL OR p_idempotency_key IS NOT NULL OR p_person_id IS NOT NULL OR
     p_opportunity_id IS NOT NULL OR p_operation IS NOT NULL OR p_draft IS NOT NULL THEN
    RAISE EXCEPTION 'Command ID required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_cmd FROM public.assistant_opportunity_commands
    WHERE id=p_command_id AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity command unavailable' USING ERRCODE='42501'; END IF;
  IF v_cmd.status='executed' AND p_stage='execute' THEN
    RETURN jsonb_build_object('ok',true,'status','executed','commandId',v_cmd.id,
      'result',v_cmd.result,'replayed',true,'businessDataWritten',false);
  END IF;
  IF v_cmd.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Opportunity command expired' USING ERRCODE='40001';
  END IF;

  IF p_stage='preview' THEN
    IF p_preview_hash IS NOT NULL OR v_cmd.status NOT IN ('planned','previewed') THEN
      RAISE EXCEPTION 'Opportunity preview unavailable' USING ERRCODE='22023';
    END IF;
    IF v_cmd.status='previewed' THEN
      RETURN jsonb_build_object('ok',true,'status','previewed','commandId',v_cmd.id,
        'preview',v_cmd.preview,'previewHash',v_cmd.preview_hash,'expiresAt',v_cmd.expires_at,
        'nextStep','confirm','replayed',true,'businessDataWritten',false);
    END IF;
    SELECT * INTO v_person FROM public.persons
      WHERE id=v_cmd.person_id AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person unavailable' USING ERRCODE='42501'; END IF;
    SELECT * INTO v_opp FROM public.opportunities
      WHERE id=v_cmd.opportunity_id AND person_id=v_cmd.person_id
        AND customer_id IS NULL AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_opp.status IN ('成交','关闭') THEN
      RAISE EXCEPTION 'Person-only Opportunity unavailable' USING ERRCODE='42501';
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid)
      INTO v_test_account;
    IF v_test_account AND (NOT EXISTS (
        SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b USING(batch_key)
        WHERE b.created_by_uid=p_actor_uid AND r.record_table='persons'
          AND r.record_id=v_person.id::text) OR NOT EXISTS (
        SELECT 1 FROM public.crm_test_records r JOIN public.crm_test_batches b USING(batch_key)
        WHERE b.created_by_uid=p_actor_uid AND r.record_table='opportunities'
          AND r.record_id=v_opp.id::text)) THEN
      RAISE EXCEPTION 'Test account requires registered fictional targets' USING ERRCODE='42501';
    END IF;

    IF v_cmd.operation='edit' THEN
      v_preview:=jsonb_build_object('id',v_opp.id,'type',v_opp.opportunity_type,
        'status',v_opp.status,'progress',v_opp.last_progress,'nextAction',v_opp.next_action,
        'nextActionDate',v_opp.next_action_date,'updatedAt',v_opp.updated_at);
      IF v_cmd.draft ? 'type' AND v_cmd.draft->>'type'<>v_opp.opportunity_type AND
        ((v_cmd.draft->>'type'='referral' AND v_opp.status NOT IN ('潜在线索','已介绍','已联系','已建立关系')) OR
         (v_cmd.draft->>'type'<>'referral' AND v_opp.status NOT IN ('发现','沟通','方案'))) THEN
        RAISE EXCEPTION 'Opportunity type change conflicts with current stage' USING ERRCODE='22023';
      END IF;
      v_after:=v_preview;
      IF v_cmd.draft ? 'type' THEN v_after:=jsonb_set(v_after,'{type}',v_cmd.draft->'type'); END IF;
      IF v_cmd.draft ? 'progress' THEN v_after:=jsonb_set(v_after,'{progress}',v_cmd.draft->'progress'); END IF;
      IF v_cmd.draft ? 'nextAction' THEN v_after:=jsonb_set(v_after,'{nextAction}',v_cmd.draft->'nextAction'); END IF;
      IF v_cmd.draft ? 'nextActionDate' THEN v_after:=jsonb_set(v_after,'{nextActionDate}',v_cmd.draft->'nextActionDate'); END IF;
      IF v_test_account AND ((v_cmd.draft ? 'progress' AND
          position('【系统测试·勿联系】' IN v_cmd.draft->>'progress')=0) OR
         (v_cmd.draft ? 'nextAction' AND
          position('【系统测试·勿联系】' IN v_cmd.draft->>'nextAction')=0)) THEN
        RAISE EXCEPTION 'Test Opportunity text must be marked' USING ERRCODE='42501';
      END IF;
      v_preview:=jsonb_build_object('operation','edit','resource','public.opportunities',
        'person',jsonb_build_object('id',v_person.id,'displayName',v_person.display_name),
        'opportunityId',v_opp.id,'before',v_preview,'after',v_after,
        'expiresAt',v_cmd.expires_at,'outcomeCreated',false);
    ELSE
      v_payload:=v_cmd.draft;
      IF v_cmd.operation='close' THEN v_payload:=v_payload||jsonb_build_object('actionId',NULL); END IF;
      v_upstream_result:=public.crm_opportunity_preview_v1(p_actor_uid,
        v_cmd.upstream_idempotency_key,v_cmd.operation,v_cmd.person_id,v_cmd.opportunity_id,v_payload);
      v_cmd.upstream_preview_id:=(v_upstream_result->>'previewId')::uuid;
      SELECT * INTO v_upstream FROM public.crm_opportunity_commands
        WHERE id=v_cmd.upstream_preview_id AND actor_uid=p_actor_uid;
      IF NOT FOUND OR v_upstream.person_id<>v_cmd.person_id OR
         v_upstream.opportunity_id<>v_cmd.opportunity_id OR v_upstream.operation<>v_cmd.operation THEN
        RAISE EXCEPTION 'Verified Opportunity preview unavailable' USING ERRCODE='42501';
      END IF;
      v_expiry:=LEAST(v_cmd.expires_at,v_upstream.expires_at);
      v_preview:=v_upstream.preview||jsonb_build_object('outcomeCreated',v_cmd.operation='close',
        'outcomeType',CASE WHEN v_cmd.operation='close' THEN
          CASE WHEN v_cmd.draft->>'status'='成交' THEN 'opportunity_sale' ELSE 'opportunity_closed' END
          ELSE NULL END,'outcomeResult',CASE WHEN v_cmd.operation='close' THEN v_cmd.draft->>'result' ELSE NULL END,
        'expiresAt',v_expiry);
    END IF;
    IF v_cmd.operation='edit' THEN v_expiry:=v_cmd.expires_at; END IF;
    v_cmd.expires_at:=v_expiry;
    v_hash:=md5(v_cmd.id::text||v_cmd.actor_uid||v_cmd.person_id::text||
      v_cmd.opportunity_id::text||v_cmd.operation||v_cmd.draft::text||v_preview::text||
      COALESCE(v_cmd.upstream_preview_id::text,'')||COALESCE(v_person.updated_at::text,'')||
      COALESCE(v_opp.updated_at::text,'')||v_expiry::text);
    UPDATE public.assistant_opportunity_commands SET status='previewed',preview=v_preview,
      preview_hash=v_hash,person_updated_at=v_person.updated_at,
      opportunity_updated_at=v_opp.updated_at,upstream_preview_id=v_cmd.upstream_preview_id,
      expires_at=v_expiry,updated_at=clock_timestamp()
      WHERE id=v_cmd.id RETURNING * INTO v_cmd;
    RETURN jsonb_build_object('ok',true,'status','previewed','commandId',v_cmd.id,
      'preview',v_cmd.preview,'previewHash',v_cmd.preview_hash,'expiresAt',v_cmd.expires_at,
      'nextStep','confirm','businessDataWritten',false);
  END IF;

  IF p_stage='confirm' THEN
    IF v_cmd.status='confirmed' AND p_preview_hash=v_cmd.preview_hash THEN
      RETURN jsonb_build_object('ok',true,'status','confirmed','commandId',v_cmd.id,
        'confirmedAt',v_cmd.confirmed_at,'nextStep','execute','replayed',true,'businessDataWritten',false);
    END IF;
    IF v_cmd.status<>'previewed' OR p_preview_hash IS NULL OR
       p_preview_hash !~ '^[0-9a-f]{32}$' OR p_preview_hash<>v_cmd.preview_hash THEN
      RAISE EXCEPTION 'Server preview confirmation required' USING ERRCODE='42501';
    END IF;
    UPDATE public.assistant_opportunity_commands SET status='confirmed',
      confirmed_by_uid=p_actor_uid,confirmed_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE id=v_cmd.id RETURNING * INTO v_cmd;
    RETURN jsonb_build_object('ok',true,'status','confirmed','commandId',v_cmd.id,
      'confirmedAt',v_cmd.confirmed_at,'nextStep','execute','businessDataWritten',false);
  END IF;

  IF v_cmd.status<>'confirmed' OR v_cmd.confirmed_by_uid<>p_actor_uid OR p_preview_hash IS NOT NULL THEN
    RAISE EXCEPTION 'Human confirmation required' USING ERRCODE='42501';
  END IF;
  IF v_cmd.operation='edit' THEN
    SELECT * INTO v_person FROM public.persons
      WHERE id=v_cmd.person_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_person.updated_at IS DISTINCT FROM v_cmd.person_updated_at THEN
      RAISE EXCEPTION 'Person changed; preview again' USING ERRCODE='40001';
    END IF;
    SELECT * INTO v_opp FROM public.opportunities
      WHERE id=v_cmd.opportunity_id AND person_id=v_cmd.person_id
        AND customer_id IS NULL AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_opp.status IN ('成交','关闭') OR
       v_opp.updated_at IS DISTINCT FROM v_cmd.opportunity_updated_at THEN
      RAISE EXCEPTION 'Opportunity changed; preview again' USING ERRCODE='40001';
    END IF;
    UPDATE public.opportunities SET
      opportunity_type=CASE WHEN v_cmd.draft ? 'type' THEN v_cmd.draft->>'type' ELSE opportunity_type END,
      last_progress=CASE WHEN v_cmd.draft ? 'progress' THEN v_cmd.draft->>'progress' ELSE last_progress END,
      next_action=CASE WHEN v_cmd.draft ? 'nextAction' THEN v_cmd.draft->>'nextAction' ELSE next_action END,
      next_action_date=CASE WHEN v_cmd.draft ? 'nextActionDate' THEN
        (CASE WHEN v_cmd.draft->'nextActionDate'='null'::jsonb THEN NULL
          ELSE (v_cmd.draft->>'nextActionDate')::date END) ELSE next_action_date END,
      updated_at=clock_timestamp()
      WHERE id=v_cmd.opportunity_id AND person_id=v_cmd.person_id AND customer_id IS NULL
        AND deleted_at IS NULL AND status NOT IN ('成交','关闭');
    IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity changed during execution' USING ERRCODE='40001'; END IF;
    v_result:=jsonb_build_object('opportunityId',v_cmd.opportunity_id,'operation','edit','outcomeId',NULL);
  ELSE
    v_result:=public.crm_opportunity_execute_v1(p_actor_uid,v_cmd.upstream_preview_id);
  END IF;
  UPDATE public.assistant_opportunity_commands SET status='executed',result=v_result,
    updated_at=clock_timestamp() WHERE id=v_cmd.id RETURNING * INTO v_cmd;
  RETURN jsonb_build_object('ok',true,'status','executed','commandId',v_cmd.id,
    'result',v_cmd.result,'replayed',false,'businessDataWritten',true);
END $function$;

REVOKE ALL ON FUNCTION public.assistant_opportunity_command_v1(text,text,uuid,uuid,bigint,bigint,text,jsonb,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.assistant_opportunity_command_v1(text,text,uuid,uuid,bigint,bigint,text,jsonb,text)
  TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
