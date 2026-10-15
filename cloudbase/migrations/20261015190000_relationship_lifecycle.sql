-- PC09: reviewed governance for directed Person-to-Person relationship edges.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF to_regclass('public.crm_relationship_commands') IS NOT NULL OR
     to_regprocedure('public.crm_relationship_preview_v1(text,uuid,bigint,text,jsonb)') IS NOT NULL OR
     to_regprocedure('public.crm_relationship_execute_v1(text,uuid)') IS NOT NULL OR
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name='relationships' AND column_name='importance') THEN
    RAISE EXCEPTION 'PC09 relationship lifecycle objects already exist; inspect before migrating';
  END IF;
END $guard$;

ALTER TABLE public.relationships ADD COLUMN importance smallint
  CONSTRAINT relationships_importance_range CHECK (importance IS NULL OR importance BETWEEN 1 AND 5);

CREATE TABLE public.crm_relationship_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  idempotency_key uuid NOT NULL,
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  relationship_id bigint REFERENCES public.relationships(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('create','update','confirm','unlink','restore')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  before_state jsonb NOT NULL,
  preview jsonb NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','executed')),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes'),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  UNIQUE(actor_uid,idempotency_key)
);
CREATE INDEX crm_relationship_commands_actor_idx ON public.crm_relationship_commands(actor_uid,created_at DESC);
CREATE INDEX crm_relationship_commands_person_idx ON public.crm_relationship_commands(person_id,created_at DESC);
ALTER TABLE public.crm_relationship_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_relationship_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_relationship_commands_service_only ON public.crm_relationship_commands
  FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON public.crm_relationship_commands FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_relationship_commands TO service_role;
GRANT INSERT (from_person_id,to_person_id,relationship_type,relationship_stage,strength,trust_level,trend,
  introduced_by_person_id,context,last_meaningful_interaction_at,source,status,confirmed_at,confirmed_by_uid,importance)
  ON public.relationships TO service_role;
GRANT UPDATE (relationship_type,relationship_stage,strength,trust_level,trend,context,source,status,
  confirmed_at,confirmed_by_uid,importance,updated_at,deleted_at,delete_batch_id)
  ON public.relationships TO service_role;

CREATE FUNCTION public.crm_relationship_preview_v1(
  p_actor_uid text,p_idempotency_key uuid,p_person_id bigint,p_operation text,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $preview$
DECLARE
  v_prior public.crm_relationship_commands%ROWTYPE;
  v_cmd public.crm_relationship_commands%ROWTYPE;
  v_edge public.relationships%ROWTYPE;
  v_from bigint; v_to bigint; v_edge_id bigint; v_type text; v_before jsonb:='{}'::jsonb;
  v_after jsonb; v_is_active boolean; v_now timestamptz:=clock_timestamp();
  v_display_before jsonb;
BEGIN
  IF current_user<>'service_role' OR p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR
     p_idempotency_key IS NULL OR p_person_id IS NULL OR p_person_id<1 OR p_operation IS NULL OR
     p_operation NOT IN ('create','update','confirm','unlink','restore') OR
     jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR length(p_payload::text)>8000 THEN
    RAISE EXCEPTION 'Invalid relationship command' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_prior FROM public.crm_relationship_commands
   WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_prior.person_id<>p_person_id OR v_prior.operation<>p_operation OR v_prior.payload<>p_payload THEN
      RAISE EXCEPTION 'Idempotency key reused with different relationship command' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('previewId',v_prior.id,'preview',v_prior.preview,'expiresAt',v_prior.expires_at,
      'replayed',true,'executed',v_prior.status='executed','result',v_prior.result);
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.persons WHERE id=p_person_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Active Person not found' USING ERRCODE='P0002';
  END IF;
  IF p_operation='create' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN
      ('fromPersonId','toPersonId','relationshipType','relationshipStage','strength','trustLevel','trend','importance','source')) OR
       NOT(p_payload?'fromPersonId' AND p_payload?'toPersonId' AND p_payload?'relationshipType') THEN
      RAISE EXCEPTION 'Invalid relationship create payload' USING ERRCODE='22023';
    END IF;
    v_from:=(p_payload->>'fromPersonId')::bigint; v_to:=(p_payload->>'toPersonId')::bigint;
  ELSE
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN
      ('relationshipId','relationshipType','relationshipStage','strength','trustLevel','trend','importance','source')) OR
       NOT(p_payload?'relationshipId') THEN RAISE EXCEPTION 'Invalid relationship payload' USING ERRCODE='22023'; END IF;
    v_edge_id:=(p_payload->>'relationshipId')::bigint;
    SELECT * INTO v_edge FROM public.relationships WHERE id=v_edge_id FOR UPDATE;
    IF NOT FOUND OR (v_edge.from_person_id<>p_person_id AND v_edge.to_person_id<>p_person_id) OR
       (p_operation IN ('update','confirm','unlink') AND v_edge.deleted_at IS NOT NULL) OR
       (p_operation='restore' AND v_edge.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Relationship not found for this Person or state changed' USING ERRCODE='40001';
    END IF;
    v_from:=v_edge.from_person_id; v_to:=v_edge.to_person_id;
    v_before:=to_jsonb(v_edge);
  END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_from=p_person_id AND v_to=p_person_id OR v_from=v_to OR
     NOT EXISTS(SELECT 1 FROM public.persons WHERE id=v_from AND deleted_at IS NULL) OR
     NOT EXISTS(SELECT 1 FROM public.persons WHERE id=v_to AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Relationship endpoints must be distinct active Persons' USING ERRCODE='22023';
  END IF;
  IF p_operation='create' AND p_person_id NOT IN(v_from,v_to) THEN
    RAISE EXCEPTION 'Relationship is outside this Person scope' USING ERRCODE='42501';
  END IF;
  v_type:=coalesce(p_payload->>'relationshipType',v_edge.relationship_type);
  IF v_type NOT IN ('family','friend','colleague','business','referral','other') THEN
    RAISE EXCEPTION 'Invalid relationship type' USING ERRCODE='22023';
  END IF;
  IF p_payload?'importance' AND p_payload->'importance'<>'null'::jsonb AND
     (jsonb_typeof(p_payload->'importance')<>'number' OR (p_payload->>'importance')::numeric NOT BETWEEN 1 AND 5 OR
       trunc((p_payload->>'importance')::numeric)<>(p_payload->>'importance')::numeric) THEN
    RAISE EXCEPTION 'Invalid relationship importance' USING ERRCODE='22023';
  END IF;
  IF p_operation='create' AND EXISTS(SELECT 1 FROM public.relationships WHERE from_person_id=v_from AND
    to_person_id=v_to AND relationship_type=v_type AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Active relationship already exists' USING ERRCODE='23505';
  END IF;
  IF p_operation='update' AND EXISTS(SELECT 1 FROM public.relationships r WHERE r.from_person_id=v_from AND
    r.to_person_id=v_to AND r.relationship_type=v_type AND r.deleted_at IS NULL AND r.id<>v_edge.id) THEN
    RAISE EXCEPTION 'Active relationship already exists' USING ERRCODE='23505';
  END IF;
  v_is_active:=v_edge.id IS NULL OR v_edge.deleted_at IS NULL;
  v_after:=jsonb_build_object('fromPersonId',v_from,'toPersonId',v_to,'relationshipType',v_type,
    'relationshipStage',coalesce(p_payload->>'relationshipStage',v_edge.relationship_stage),
    'strength',coalesce(p_payload->>'strength',v_edge.strength),
    'trustLevel',coalesce(p_payload->>'trustLevel',v_edge.trust_level),
    'trend',coalesce(p_payload->>'trend',v_edge.trend),
    'importance',CASE WHEN p_payload?'importance' THEN p_payload->'importance' ELSE to_jsonb(v_edge.importance) END,
    'source',coalesce(p_payload->>'source',v_edge.source,'manual'),
    'status',CASE WHEN p_operation='create' THEN 'pending' WHEN p_operation='confirm' THEN 'confirmed'
      WHEN p_operation IN('unlink','restore') THEN v_edge.status ELSE v_edge.status END,
    'deleted',CASE WHEN p_operation='unlink' THEN true WHEN p_operation='restore' THEN false ELSE NOT v_is_active END);
  v_display_before:=CASE WHEN v_edge.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
    'relationshipId',v_edge.id,'fromPersonId',v_edge.from_person_id,'toPersonId',v_edge.to_person_id,
    'relationshipType',v_edge.relationship_type,'relationshipStage',v_edge.relationship_stage,
    'strength',v_edge.strength,'trustLevel',v_edge.trust_level,'trend',v_edge.trend,
    'source',v_edge.source,'status',v_edge.status,'importance',v_edge.importance,
    'confirmedAt',v_edge.confirmed_at,'lastMeaningfulInteractionAt',v_edge.last_meaningful_interaction_at,
    'deletedAt',v_edge.deleted_at,'updatedAt',v_edge.updated_at) END;
  INSERT INTO public.crm_relationship_commands(actor_uid,idempotency_key,person_id,relationship_id,operation,payload,before_state,preview)
   VALUES(p_actor_uid,p_idempotency_key,p_person_id,v_edge_id,p_operation,p_payload,v_before,
     jsonb_build_object('personId',p_person_id,'before',v_display_before,'after',v_after,
       'fromPersonId',v_from,'toPersonId',v_to,'humanConfirmationRequired',true)) RETURNING * INTO v_cmd;
  RETURN jsonb_build_object('previewId',v_cmd.id,'preview',v_cmd.preview,'expiresAt',v_cmd.expires_at,'replayed',false);
END $preview$;

CREATE FUNCTION public.crm_relationship_execute_v1(p_actor_uid text,p_preview_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $execute$
DECLARE
 v_cmd public.crm_relationship_commands%ROWTYPE; v_edge public.relationships%ROWTYPE;
 v_from bigint; v_to bigint; v_locked integer; v_now timestamptz:=clock_timestamp(); v_result jsonb; v_type text;
BEGIN
 IF current_user<>'service_role' OR p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_preview_id IS NULL THEN
   RAISE EXCEPTION 'Invalid relationship execution' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_cmd FROM public.crm_relationship_commands WHERE id=p_preview_id AND actor_uid=p_actor_uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Relationship preview not found' USING ERRCODE='P0002'; END IF;
 IF v_cmd.status='executed' THEN RETURN jsonb_build_object('ok',true,'replayed',true,'result',v_cmd.result); END IF;
 IF v_cmd.expires_at<=v_now THEN RAISE EXCEPTION 'Relationship preview expired; preview again' USING ERRCODE='22023'; END IF;
 IF v_cmd.operation='create' THEN
   v_from:=(v_cmd.payload->>'fromPersonId')::bigint; v_to:=(v_cmd.payload->>'toPersonId')::bigint;
   PERFORM 1 FROM public.persons WHERE id IN(v_from,v_to) AND deleted_at IS NULL ORDER BY id FOR UPDATE;
   GET DIAGNOSTICS v_locked=ROW_COUNT;
   IF v_locked<>2 OR v_cmd.person_id NOT IN(v_from,v_to) OR v_from=v_to THEN
     RAISE EXCEPTION 'Relationship endpoints must remain active and in scope' USING ERRCODE='40001'; END IF;
   v_type:=v_cmd.payload->>'relationshipType';
   IF EXISTS(SELECT 1 FROM public.relationships WHERE from_person_id=v_from AND to_person_id=v_to AND relationship_type=v_type AND deleted_at IS NULL) THEN
     RAISE EXCEPTION 'Active relationship already exists; preview again' USING ERRCODE='23505'; END IF;
   INSERT INTO public.relationships(from_person_id,to_person_id,relationship_type,relationship_stage,strength,trust_level,trend,
     source,status,importance,context,created_at,updated_at)
   VALUES(v_from,v_to,v_type,v_cmd.payload->>'relationshipStage',v_cmd.payload->>'strength',v_cmd.payload->>'trustLevel',
     v_cmd.payload->>'trend',coalesce(v_cmd.payload->>'source','manual'),'pending',
     CASE WHEN v_cmd.payload->'importance'='null'::jsonb THEN NULL ELSE (v_cmd.payload->>'importance')::smallint END,
     '{}'::jsonb,v_now,v_now) RETURNING * INTO v_edge;
 ELSIF v_cmd.operation='restore' THEN
   SELECT * INTO v_edge FROM public.relationships WHERE id=v_cmd.relationship_id FOR UPDATE;
   IF NOT FOUND OR v_edge.deleted_at IS NULL OR to_jsonb(v_edge)-'deleted_at'-'updated_at' IS DISTINCT FROM
      v_cmd.before_state-'deleted_at'-'updated_at' THEN RAISE EXCEPTION 'Relationship changed; preview again' USING ERRCODE='40001'; END IF;
   PERFORM 1 FROM public.persons WHERE id IN(v_edge.from_person_id,v_edge.to_person_id) AND deleted_at IS NULL ORDER BY id FOR UPDATE;
   GET DIAGNOSTICS v_locked=ROW_COUNT;
   IF v_locked<>2 OR v_cmd.person_id NOT IN(v_edge.from_person_id,v_edge.to_person_id) THEN
     RAISE EXCEPTION 'Relationship endpoints must remain active and in scope' USING ERRCODE='40001'; END IF;
   IF EXISTS(SELECT 1 FROM public.relationships r WHERE r.from_person_id=v_edge.from_person_id AND r.to_person_id=v_edge.to_person_id
     AND r.relationship_type=v_edge.relationship_type AND r.deleted_at IS NULL) THEN RAISE EXCEPTION 'Active relationship already exists; cannot restore' USING ERRCODE='23505'; END IF;
   UPDATE public.relationships SET deleted_at=NULL,updated_at=v_now WHERE id=v_edge.id RETURNING * INTO v_edge;
 ELSE
   SELECT * INTO v_edge FROM public.relationships WHERE id=v_cmd.relationship_id FOR UPDATE;
   IF NOT FOUND OR v_edge.deleted_at IS NOT NULL OR v_edge.updated_at IS DISTINCT FROM (v_cmd.before_state->>'updated_at')::timestamptz OR
      v_edge.status IS DISTINCT FROM v_cmd.before_state->>'status' THEN RAISE EXCEPTION 'Relationship changed; preview again' USING ERRCODE='40001'; END IF;
   PERFORM 1 FROM public.persons WHERE id IN(v_edge.from_person_id,v_edge.to_person_id) AND deleted_at IS NULL ORDER BY id FOR UPDATE;
   GET DIAGNOSTICS v_locked=ROW_COUNT;
   IF v_locked<>2 OR v_cmd.person_id NOT IN(v_edge.from_person_id,v_edge.to_person_id) THEN
     RAISE EXCEPTION 'Relationship endpoints must remain active and in scope' USING ERRCODE='40001'; END IF;
   IF v_cmd.operation='unlink' THEN
     UPDATE public.relationships SET deleted_at=v_now,updated_at=v_now WHERE id=v_edge.id RETURNING * INTO v_edge;
   ELSIF v_cmd.operation='confirm' THEN
     IF v_edge.status<>'pending' THEN RAISE EXCEPTION 'Relationship is already confirmed' USING ERRCODE='40001'; END IF;
     UPDATE public.relationships SET status='confirmed',confirmed_at=v_now,confirmed_by_uid=p_actor_uid,updated_at=v_now
       WHERE id=v_edge.id RETURNING * INTO v_edge;
   ELSE
     IF v_edge.from_person_id<>v_cmd.person_id AND v_edge.to_person_id<>v_cmd.person_id THEN RAISE EXCEPTION 'Relationship is outside this Person scope' USING ERRCODE='42501'; END IF;
     UPDATE public.relationships SET relationship_type=coalesce(v_cmd.payload->>'relationshipType',relationship_type),
       relationship_stage=CASE WHEN v_cmd.payload?'relationshipStage' THEN v_cmd.payload->>'relationshipStage' ELSE relationship_stage END,
       strength=CASE WHEN v_cmd.payload?'strength' THEN v_cmd.payload->>'strength' ELSE strength END,
       trust_level=CASE WHEN v_cmd.payload?'trustLevel' THEN v_cmd.payload->>'trustLevel' ELSE trust_level END,
       trend=CASE WHEN v_cmd.payload?'trend' THEN v_cmd.payload->>'trend' ELSE trend END,
       importance=CASE WHEN v_cmd.payload?'importance' THEN nullif(v_cmd.payload->>'importance','null')::smallint ELSE importance END,
       status=CASE WHEN status='confirmed' THEN status ELSE 'pending' END,
       confirmed_at=CASE WHEN status='confirmed' THEN v_now ELSE confirmed_at END,
       confirmed_by_uid=CASE WHEN status='confirmed' THEN p_actor_uid ELSE confirmed_by_uid END,
       updated_at=v_now WHERE id=v_edge.id RETURNING * INTO v_edge;
   END IF;
 END IF;
 v_result:=jsonb_build_object('relationshipId',v_edge.id,'fromPersonId',v_edge.from_person_id,'toPersonId',v_edge.to_person_id,
   'relationshipType',v_edge.relationship_type,'status',v_edge.status,'deleted',v_edge.deleted_at IS NOT NULL,
   'importance',v_edge.importance,'updatedAt',v_edge.updated_at);
 UPDATE public.crm_relationship_commands SET status='executed',executed_at=v_now,result=v_result,relationship_id=v_edge.id WHERE id=v_cmd.id;
 RETURN jsonb_build_object('ok',true,'replayed',false,'result',v_result);
END $execute$;

REVOKE ALL ON FUNCTION public.crm_relationship_preview_v1(text,uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.crm_relationship_execute_v1(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.crm_relationship_preview_v1(text,uuid,bigint,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_relationship_execute_v1(text,uuid) TO service_role;
COMMIT;
