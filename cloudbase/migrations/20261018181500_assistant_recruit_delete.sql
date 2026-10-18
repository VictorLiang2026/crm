-- PC28: one Person-only recruit candidate, actor-bound command and exact batch impact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.assistant_recruit_delete_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  idempotency_key uuid NOT NULL UNIQUE,
  request_text text NOT NULL CHECK (length(btrim(request_text)) BETWEEN 1 AND 1200),
  person_mention text NOT NULL CHECK (length(btrim(person_mention)) BETWEEN 1 AND 120),
  person_id bigint NOT NULL,
  candidate_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','previewed','confirmed','executed')),
  preview jsonb,
  preview_hash text,
  impact_snapshot jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  confirmed_by_uid text,
  confirmed_at timestamptz,
  result jsonb,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('planned','previewed') AND confirmed_by_uid IS NULL AND confirmed_at IS NULL)
      OR (status IN ('confirmed','executed') AND confirmed_by_uid = actor_uid AND confirmed_at IS NOT NULL)),
  CHECK ((status = 'planned' AND preview IS NULL AND preview_hash IS NULL AND impact_snapshot IS NULL)
      OR (status IN ('previewed','confirmed','executed') AND preview IS NOT NULL
        AND preview_hash IS NOT NULL AND impact_snapshot IS NOT NULL))
);
CREATE INDEX assistant_recruit_delete_commands_actor_idx
  ON public.assistant_recruit_delete_commands(actor_uid,created_at DESC);
CREATE INDEX assistant_recruit_delete_commands_expiry_idx
  ON public.assistant_recruit_delete_commands(expires_at) WHERE status <> 'executed';
ALTER TABLE public.assistant_recruit_delete_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_recruit_delete_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_recruit_delete_commands_service_only
  ON public.assistant_recruit_delete_commands FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.assistant_recruit_delete_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.assistant_recruit_delete_commands TO service_role;

CREATE FUNCTION public.assistant_recruit_delete_command_v1(
  p_stage text,p_actor_uid text,p_command_id uuid DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,p_person_id bigint DEFAULT NULL,
  p_candidate_id bigint DEFAULT NULL,p_request_text text DEFAULT NULL,
  p_person_mention text DEFAULT NULL,p_preview_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
SET lock_timeout='5s'
AS $function$
DECLARE
  v_cmd public.assistant_recruit_delete_commands%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_candidate public.recruit_candidates%ROWTYPE;
  v_text text;
  v_followups jsonb;
  v_snapshot jsonb;
  v_preview jsonb;
  v_hash text;
  v_active_ids bigint[];
  v_predeleted_count bigint;
  v_delete jsonb;
  v_batch uuid;
  v_deleted_count bigint;
  v_result jsonb;
BEGIN
  IF current_user <> 'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR
     p_stage NOT IN ('plan','preview','confirm','execute') OR p_stage IS NULL THEN
    RAISE EXCEPTION 'Invalid recruit delete command' USING ERRCODE='22023';
  END IF;

  IF p_stage = 'plan' THEN
    v_text := btrim(coalesce(p_request_text,''));
    IF p_command_id IS NOT NULL OR p_preview_hash IS NOT NULL OR
       p_idempotency_key IS NULL OR p_person_id IS NULL OR p_person_id <= 0 OR
       p_candidate_id IS NULL OR p_candidate_id <= 0 OR
       length(v_text) NOT BETWEEN 1 AND 1200 OR
       length(btrim(coalesce(p_person_mention,''))) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'Invalid recruit delete plan' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_cmd FROM public.assistant_recruit_delete_commands
      WHERE idempotency_key=p_idempotency_key FOR UPDATE;
    IF FOUND THEN
      IF v_cmd.actor_uid <> p_actor_uid THEN
        RAISE EXCEPTION 'Idempotency key belongs to another actor' USING ERRCODE='42501';
      END IF;
      IF v_cmd.request_text <> v_text OR v_cmd.person_mention <> btrim(p_person_mention) OR
         v_cmd.person_id <> p_person_id OR v_cmd.candidate_id <> p_candidate_id THEN
        RAISE EXCEPTION 'Idempotency key belongs to another request' USING ERRCODE='22023';
      END IF;
      RETURN jsonb_build_object('ok',true,'status',v_cmd.status,'commandId',v_cmd.id,
        'expiresAt',v_cmd.expires_at,'result',v_cmd.result,'replayed',v_cmd.status='executed');
    END IF;
    -- Lock in the same parent-before-candidate order as the existing delete RPC.
    SELECT * INTO v_person FROM public.persons WHERE id=p_person_id FOR UPDATE;
    IF NOT FOUND OR v_person.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Person unavailable' USING ERRCODE='40001';
    END IF;
    SELECT * INTO v_candidate FROM public.recruit_candidates
      WHERE id=p_candidate_id FOR UPDATE;
    IF NOT FOUND OR v_candidate.person_id IS DISTINCT FROM p_person_id OR
       v_candidate.customer_id IS NOT NULL OR v_candidate.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Candidate is outside the Person-only delete allowlist' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid)
       AND (position('【系统测试·勿联系】' IN coalesce(v_person.display_name,''))=0 OR
         NOT EXISTS (
           SELECT 1 FROM public.crm_test_records cr
           JOIN public.crm_test_records person_record ON person_record.batch_key=cr.batch_key
             AND person_record.record_table='persons' AND person_record.record_id=p_person_id::text
           JOIN public.crm_test_batches b ON b.batch_key=cr.batch_key
           WHERE b.created_by_uid=p_actor_uid AND cr.record_table='recruit_candidates'
             AND cr.record_id=p_candidate_id::text)) THEN
      RAISE EXCEPTION 'Test account requires a tracked fictional candidate' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.assistant_recruit_delete_commands
      (actor_uid,idempotency_key,request_text,person_mention,person_id,candidate_id)
      VALUES (p_actor_uid,p_idempotency_key,v_text,btrim(p_person_mention),p_person_id,p_candidate_id)
      ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_cmd FROM public.assistant_recruit_delete_commands
      WHERE idempotency_key=p_idempotency_key FOR UPDATE;
    IF NOT FOUND OR v_cmd.actor_uid <> p_actor_uid THEN
      RAISE EXCEPTION 'Idempotency key belongs to another actor' USING ERRCODE='42501';
    END IF;
    IF v_cmd.request_text <> v_text OR v_cmd.person_mention <> btrim(p_person_mention) OR
       v_cmd.person_id <> p_person_id OR
       v_cmd.candidate_id <> p_candidate_id THEN
      RAISE EXCEPTION 'Idempotency key belongs to another request' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('ok',true,'status',v_cmd.status,'commandId',v_cmd.id,
      'expiresAt',v_cmd.expires_at,'result',v_cmd.result,'replayed',v_cmd.status='executed');
  END IF;

  IF p_command_id IS NULL OR p_idempotency_key IS NOT NULL OR p_person_id IS NOT NULL OR
     p_candidate_id IS NOT NULL OR p_request_text IS NOT NULL OR p_person_mention IS NOT NULL OR
     (p_stage='confirm' AND (p_preview_hash IS NULL OR p_preview_hash !~ '^[0-9a-f]{32}$')) OR
     (p_stage<>'confirm' AND p_preview_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid recruit delete stage arguments' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_cmd FROM public.assistant_recruit_delete_commands
    WHERE id=p_command_id FOR UPDATE;
  IF NOT FOUND OR v_cmd.actor_uid <> p_actor_uid THEN
    RAISE EXCEPTION 'Command not found for actor' USING ERRCODE='42501';
  END IF;
  IF p_stage='execute' AND v_cmd.status='executed' THEN
    RETURN jsonb_build_object('ok',true,'status','executed','commandId',v_cmd.id,
      'result',v_cmd.result,'replayed',true);
  END IF;
  IF v_cmd.expires_at <= now() THEN
    RAISE EXCEPTION 'Recruit delete preview expired' USING ERRCODE='40001';
  END IF;

  IF p_stage='confirm' THEN
    IF v_cmd.status<>'previewed' OR v_cmd.preview_hash<>p_preview_hash THEN
      RAISE EXCEPTION 'Server preview confirmation required' USING ERRCODE='42501';
    END IF;
    UPDATE public.assistant_recruit_delete_commands
      SET status='confirmed',confirmed_by_uid=p_actor_uid,confirmed_at=now(),updated_at=now()
      WHERE id=v_cmd.id;
    RETURN jsonb_build_object('ok',true,'status','confirmed','commandId',v_cmd.id,
      'expiresAt',v_cmd.expires_at);
  END IF;
  IF (p_stage='preview' AND v_cmd.status NOT IN ('planned','previewed')) OR
     (p_stage='execute' AND (v_cmd.status<>'confirmed' OR
       v_cmd.confirmed_by_uid IS DISTINCT FROM p_actor_uid)) THEN
    RAISE EXCEPTION 'Recruit delete stage is not confirmed' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_person FROM public.persons WHERE id=v_cmd.person_id FOR UPDATE;
  IF NOT FOUND OR v_person.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Person changed; preview again' USING ERRCODE='40001';
  END IF;
  SELECT * INTO v_candidate FROM public.recruit_candidates
    WHERE id=v_cmd.candidate_id FOR UPDATE;
  IF NOT FOUND OR v_candidate.person_id IS DISTINCT FROM v_cmd.person_id OR
     v_candidate.customer_id IS NOT NULL OR v_candidate.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Candidate changed; preview again' USING ERRCODE='40001';
  END IF;
  -- Lock every existing child, including previously deleted rows, so restoration
  -- or edits cannot expand the active set between the snapshot and batch delete.
  PERFORM id FROM public.recruit_followups WHERE candidate_id=v_cmd.candidate_id
    ORDER BY id FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(rf) ORDER BY rf.id),'[]'::jsonb),
    coalesce(array_agg(rf.id ORDER BY rf.id) FILTER (WHERE rf.deleted_at IS NULL),'{}'::bigint[]),
    count(*) FILTER (WHERE rf.deleted_at IS NOT NULL)
    INTO v_followups,v_active_ids,v_predeleted_count
    FROM public.recruit_followups rf WHERE rf.candidate_id=v_cmd.candidate_id;
  v_snapshot := jsonb_build_object(
    'person',jsonb_build_object('id',v_person.id,'name',v_person.display_name,
      'updatedAt',v_person.updated_at,'deletedAt',v_person.deleted_at),
    'candidate',to_jsonb(v_candidate),'followups',v_followups);
  IF p_stage='preview' THEN
    IF v_cmd.status='previewed' THEN
      IF v_cmd.impact_snapshot IS DISTINCT FROM v_snapshot THEN
        RAISE EXCEPTION 'Recruit delete impact changed; preview again' USING ERRCODE='40001';
      END IF;
      RETURN jsonb_build_object('ok',true,'status','previewed','commandId',v_cmd.id,
        'preview',v_cmd.preview,'previewHash',v_cmd.preview_hash,
        'expiresAt',v_cmd.expires_at);
    END IF;
    v_preview := jsonb_build_object('personId',v_person.id,'personName',v_person.display_name,
      'candidateId',v_candidate.id,'candidateStage',v_candidate.stage,
      'candidateUpdatedAt',v_candidate.updated_at,'followupIds',to_jsonb(v_active_ids),
      'followupCount',cardinality(v_active_ids),'alreadyDeletedFollowupCount',v_predeleted_count,
      'preserved',jsonb_build_array('person','attachments','previously_deleted_followups'));
    v_hash := md5(gen_random_uuid()::text || v_preview::text);
    UPDATE public.assistant_recruit_delete_commands
      SET status='previewed',preview=v_preview,preview_hash=v_hash,
        impact_snapshot=v_snapshot,updated_at=now() WHERE id=v_cmd.id;
    RETURN jsonb_build_object('ok',true,'status','previewed','commandId',v_cmd.id,
      'preview',v_preview,'previewHash',v_hash,'expiresAt',v_cmd.expires_at);
  END IF;

  IF v_cmd.impact_snapshot IS DISTINCT FROM v_snapshot THEN
    RAISE EXCEPTION 'Recruit delete impact changed; preview again' USING ERRCODE='40001';
  END IF;
  v_delete := public.crm_person_only_recruit_delete_v1(
    p_actor_uid,'remove',ARRAY[v_cmd.candidate_id]);
  IF NOT coalesce((v_delete->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'Recruit delete refused' USING ERRCODE='40001';
  END IF;
  SELECT delete_batch_id INTO v_batch FROM public.recruit_candidates
    WHERE id=v_cmd.candidate_id AND deleted_at IS NOT NULL;
  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'Delete batch missing' USING ERRCODE='40001';
  END IF;
  SELECT count(*) INTO v_deleted_count FROM public.recruit_followups
    WHERE candidate_id=v_cmd.candidate_id
      AND deleted_at IS NOT NULL AND delete_batch_id=v_batch;
  IF v_deleted_count<>cardinality(v_active_ids) OR
     EXISTS (SELECT 1 FROM public.recruit_followups
       WHERE candidate_id=v_cmd.candidate_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Delete impact mismatch' USING ERRCODE='40001';
  END IF;
  v_result := jsonb_build_object('personId',v_cmd.person_id,'candidateId',v_cmd.candidate_id,
    'batchId',v_batch,'followupIds',to_jsonb(v_active_ids),
    'followupCount',cardinality(v_active_ids),'alreadyDeletedFollowupCount',v_predeleted_count);
  UPDATE public.assistant_recruit_delete_commands
    SET status='executed',result=v_result,executed_at=now(),updated_at=now()
    WHERE id=v_cmd.id;
  RETURN jsonb_build_object('ok',true,'status','executed','commandId',v_cmd.id,
    'result',v_result,'replayed',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.assistant_recruit_delete_command_v1(
  text,text,uuid,uuid,bigint,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_recruit_delete_command_v1(
  text,text,uuid,uuid,bigint,bigint,text,text,text) TO service_role;

COMMIT;
