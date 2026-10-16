BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'outcomes' AND column_name = 'ai_result_id'
  ) OR to_regclass('public.crm_recruit_coach_outcome_commands') IS NOT NULL OR
     to_regprocedure('public.crm_recruit_coach_outcome_v1(text,text,uuid,bigint,bigint,bigint,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Recruit Coach Outcome objects already exist';
  END IF;
END $guard$;

ALTER TABLE public.outcomes
  ADD COLUMN ai_result_id bigint REFERENCES public.ai_results(id) ON DELETE RESTRICT;
CREATE INDEX outcomes_ai_result_idx ON public.outcomes(ai_result_id, occurred_at DESC)
  WHERE ai_result_id IS NOT NULL;
COMMENT ON COLUMN public.outcomes.ai_result_id IS
  'PC20 trace link to the human-reviewed Recruit Coach AI result; nullable for legacy outcomes.';

CREATE TABLE public.crm_recruit_coach_outcome_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  candidate_id bigint NOT NULL REFERENCES public.recruit_candidates(id) ON DELETE RESTRICT,
  ai_result_id bigint NOT NULL REFERENCES public.ai_results(id) ON DELETE RESTRICT,
  action_id bigint REFERENCES public.actions(id) ON DELETE RESTRICT,
  draft jsonb NOT NULL,
  status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','confirmed','executed')),
  preview_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  confirmed_by_uid text,
  confirmed_at timestamptz,
  outcome_id bigint UNIQUE REFERENCES public.outcomes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruit_coach_outcome_confirmation_check CHECK (
    (status = 'previewed' AND confirmed_by_uid IS NULL AND confirmed_at IS NULL AND outcome_id IS NULL)
    OR (status = 'confirmed' AND confirmed_by_uid IS NOT NULL AND confirmed_at IS NOT NULL AND outcome_id IS NULL)
    OR (status = 'executed' AND confirmed_by_uid IS NOT NULL AND confirmed_at IS NOT NULL AND outcome_id IS NOT NULL)
  )
);
CREATE INDEX recruit_coach_outcome_actor_idx
  ON public.crm_recruit_coach_outcome_commands(actor_uid, created_at DESC);
CREATE INDEX recruit_coach_outcome_expiry_idx
  ON public.crm_recruit_coach_outcome_commands(expires_at) WHERE status <> 'executed';
ALTER TABLE public.crm_recruit_coach_outcome_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_recruit_coach_outcome_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY recruit_coach_outcome_commands_service_only
  ON public.crm_recruit_coach_outcome_commands FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.crm_recruit_coach_outcome_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_recruit_coach_outcome_commands TO service_role;

CREATE FUNCTION public.crm_recruit_coach_outcome_v1(
  p_stage text, p_actor_uid text, p_command_id uuid DEFAULT NULL,
  p_candidate_id bigint DEFAULT NULL, p_ai_result_id bigint DEFAULT NULL,
  p_action_id bigint DEFAULT NULL, p_draft jsonb DEFAULT NULL,
  p_preview_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $function$
DECLARE
  v_cmd public.crm_recruit_coach_outcome_commands%ROWTYPE;
  v_candidate public.recruit_candidates%ROWTYPE;
  v_result public.ai_results%ROWTYPE;
  v_task public.ai_tasks%ROWTYPE;
  v_action public.actions%ROWTYPE;
  v_hash text;
  v_occurred_at timestamptz;
  v_outcome_id bigint;
BEGIN
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR
     p_stage NOT IN ('preview','confirm','execute') THEN
    RAISE EXCEPTION 'Invalid Recruit Coach Outcome command' USING ERRCODE = '22023';
  END IF;
  IF p_stage = 'preview' THEN
    IF p_command_id IS NOT NULL OR p_preview_hash IS NOT NULL OR p_candidate_id IS NULL OR
       p_ai_result_id IS NULL OR jsonb_typeof(p_draft) IS DISTINCT FROM 'object' OR
       (SELECT count(*) FROM jsonb_object_keys(p_draft)) NOT BETWEEN 2 AND 3 OR
       EXISTS (SELECT 1 FROM jsonb_object_keys(p_draft) k WHERE k NOT IN ('outcome_type','result','occurred_at')) OR
       p_draft->>'outcome_type' <> 'recruit_followup' OR
       jsonb_typeof(p_draft->'result') IS DISTINCT FROM 'string' OR
       length(btrim(p_draft->>'result')) NOT BETWEEN 1 AND 4000 OR
       jsonb_typeof(p_draft->'occurred_at') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid Recruit Coach Outcome draft' USING ERRCODE = '22023';
    END IF;
    v_occurred_at := (p_draft->>'occurred_at')::timestamptz;
    IF v_occurred_at > now() + interval '1 day' THEN
      RAISE EXCEPTION 'Outcome time cannot be in the future' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_candidate FROM public.recruit_candidates
      WHERE id=p_candidate_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recruit candidate not found' USING ERRCODE = '23503'; END IF;
    SELECT * INTO v_result FROM public.ai_results WHERE id=p_ai_result_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recruit Coach result not found' USING ERRCODE = '23503'; END IF;
    SELECT * INTO v_task FROM public.ai_tasks WHERE id=v_result.task_id;
    IF NOT FOUND OR v_task.task_type <> 'recruit_coach' OR v_task.skill_name <> 'recruit_coach' OR
       v_task.subject_type <> 'candidate' OR v_task.subject_id <> p_candidate_id::text OR
       v_result.feedback IS DISTINCT FROM 'PC20:accepted' AND
       v_result.feedback IS DISTINCT FROM 'PC20:modified' THEN
      RAISE EXCEPTION 'Recruit Coach result must be accepted for this candidate' USING ERRCODE = '42501';
    END IF;
    IF p_action_id IS NOT NULL THEN
      SELECT * INTO v_action FROM public.actions WHERE id=p_action_id AND person_id=v_candidate.person_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Action does not belong to this Person or is inactive' USING ERRCODE = '23503'; END IF;
    END IF;
    v_hash := md5(jsonb_build_object('candidateId',p_candidate_id,'aiResultId',p_ai_result_id,
      'actionId',p_action_id,'draft',jsonb_build_object('outcome_type','recruit_followup',
      'result',btrim(p_draft->>'result'),'occurred_at',v_occurred_at))::text || ':' || gen_random_uuid()::text);
    INSERT INTO public.crm_recruit_coach_outcome_commands(
      actor_uid,person_id,candidate_id,ai_result_id,action_id,draft,preview_hash
    ) VALUES (p_actor_uid,v_candidate.person_id,p_candidate_id,p_ai_result_id,p_action_id,
      jsonb_build_object('outcome_type','recruit_followup','result',btrim(p_draft->>'result'),
        'occurred_at',v_occurred_at),v_hash) RETURNING * INTO v_cmd;
    RETURN jsonb_build_object('ok',true,'status','previewed','previewId',v_cmd.id,
      'previewHash',v_cmd.preview_hash,'expiresAt',v_cmd.expires_at,
      'preview',jsonb_build_object('personId',v_cmd.person_id,'candidateId',v_cmd.candidate_id,
        'aiResultId',v_cmd.ai_result_id,'actionId',v_cmd.action_id,'draft',v_cmd.draft),
      'businessDataWritten',false);
  END IF;
  IF p_command_id IS NULL OR p_candidate_id IS NOT NULL OR p_ai_result_id IS NOT NULL OR
     p_action_id IS NOT NULL OR p_draft IS NOT NULL THEN
    RAISE EXCEPTION 'Preview ID required without a new draft' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_cmd FROM public.crm_recruit_coach_outcome_commands
    WHERE id=p_command_id FOR UPDATE;
  IF NOT FOUND OR v_cmd.actor_uid <> p_actor_uid THEN
    RAISE EXCEPTION 'Outcome preview not found for actor' USING ERRCODE = '42501';
  END IF;
  IF v_cmd.status = 'executed' AND p_stage = 'execute' THEN
    RETURN jsonb_build_object('ok',true,'status','executed','previewId',v_cmd.id,
      'outcomeId',v_cmd.outcome_id,'replayed',true,'businessDataWritten',false);
  END IF;
  IF v_cmd.expires_at < now() THEN RAISE EXCEPTION 'Outcome preview expired' USING ERRCODE = '40001'; END IF;
  SELECT * INTO v_candidate FROM public.recruit_candidates
    WHERE id=v_cmd.candidate_id AND person_id=v_cmd.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recruit candidate changed' USING ERRCODE = '40001'; END IF;
  SELECT * INTO v_result FROM public.ai_results WHERE id=v_cmd.ai_result_id FOR UPDATE;
  IF NOT FOUND OR (v_result.feedback IS DISTINCT FROM 'PC20:accepted' AND
      v_result.feedback IS DISTINCT FROM 'PC20:modified') THEN
    RAISE EXCEPTION 'Recruit Coach decision changed' USING ERRCODE = '40001';
  END IF;
  IF v_cmd.action_id IS NOT NULL THEN
    PERFORM 1 FROM public.actions WHERE id=v_cmd.action_id AND person_id=v_cmd.person_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Action changed since preview' USING ERRCODE = '40001'; END IF;
  END IF;
  IF p_stage = 'confirm' THEN
    IF v_cmd.status <> 'previewed' OR p_preview_hash IS NULL OR p_preview_hash <> v_cmd.preview_hash OR
       length(p_preview_hash) <> 32 THEN
      RAISE EXCEPTION 'Server preview confirmation required' USING ERRCODE = '42501';
    END IF;
    UPDATE public.crm_recruit_coach_outcome_commands SET status='confirmed',
      confirmed_by_uid=p_actor_uid,confirmed_at=now(),updated_at=now() WHERE id=v_cmd.id;
    RETURN jsonb_build_object('ok',true,'status','confirmed','previewId',v_cmd.id,
      'businessDataWritten',false);
  END IF;
  IF v_cmd.status <> 'confirmed' OR v_cmd.confirmed_by_uid <> p_actor_uid THEN
    RAISE EXCEPTION 'Human confirmation required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.outcomes(ai_result_id,action_id,recruit_candidate_id,outcome_type,result,occurred_at)
    VALUES (v_cmd.ai_result_id,v_cmd.action_id,v_cmd.candidate_id,'recruit_followup',
      v_cmd.draft->>'result',(v_cmd.draft->>'occurred_at')::timestamptz)
    RETURNING id INTO v_outcome_id;
  UPDATE public.crm_recruit_coach_outcome_commands SET status='executed',outcome_id=v_outcome_id,
    updated_at=now() WHERE id=v_cmd.id;
  RETURN jsonb_build_object('ok',true,'status','executed','previewId',v_cmd.id,
    'outcomeId',v_outcome_id,'replayed',false,'businessDataWritten',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_recruit_coach_outcome_v1(text,text,uuid,bigint,bigint,bigint,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruit_coach_outcome_v1(text,text,uuid,bigint,bigint,bigint,jsonb,text)
  TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
