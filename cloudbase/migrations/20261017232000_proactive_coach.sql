-- PC30: per-operator review state for deterministic Today coach candidates.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.crm_proactive_coach_decisions') IS NOT NULL OR
     to_regprocedure('public.crm_proactive_coach_decision_v1(text,uuid,bigint,text,bigint,text,integer,bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'PC30 objects already exist; inspect before migrating';
  END IF;
END
$guard$;

CREATE TABLE public.crm_proactive_coach_decisions (
  candidate_key uuid PRIMARY KEY,
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 128),
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN
    ('commitment_due','relationship_decay','relationship_changed','activity_followup','recruit_stagnation')),
  source_id bigint NOT NULL CHECK (source_id > 0),
  decision text NOT NULL CHECK (decision IN ('deferred','rejected','action_created')),
  snooze_until timestamptz,
  action_id bigint REFERENCES public.actions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_proactive_coach_decision_state_check CHECK (
    (decision='deferred' AND snooze_until IS NOT NULL AND action_id IS NULL) OR
    (decision='rejected' AND snooze_until IS NULL AND action_id IS NULL) OR
    (decision='action_created' AND snooze_until IS NULL AND action_id IS NOT NULL)
  )
);
CREATE INDEX crm_proactive_coach_actor_idx
  ON public.crm_proactive_coach_decisions(actor_uid, updated_at DESC);
CREATE INDEX crm_proactive_coach_source_idx
  ON public.crm_proactive_coach_decisions(source_type, source_id, updated_at DESC);
ALTER TABLE public.crm_proactive_coach_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_proactive_coach_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_proactive_coach_service_only ON public.crm_proactive_coach_decisions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.crm_proactive_coach_decisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.crm_proactive_coach_decisions TO service_role;

CREATE FUNCTION public.crm_proactive_coach_decision_v1(
  p_actor_uid text, p_candidate_key uuid, p_person_id bigint,
  p_source_type text, p_source_id bigint, p_decision text,
  p_snooze_days integer, p_action_id bigint
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $function$
DECLARE v_saved public.crm_proactive_coach_decisions%ROWTYPE;
  v_person public.persons%ROWTYPE; v_activity_id bigint;
BEGIN
  IF current_user <> 'service_role' OR p_actor_uid IS NULL OR
     length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 OR p_candidate_key IS NULL OR
     p_person_id IS NULL OR p_person_id < 1 OR p_source_id IS NULL OR p_source_id < 1 OR
     p_source_type NOT IN ('commitment_due','relationship_decay','relationship_changed','activity_followup','recruit_stagnation') OR
     p_decision NOT IN ('deferred','rejected','action_created') OR
     (p_decision='deferred' AND (p_snooze_days IS NULL OR p_snooze_days NOT BETWEEN 1 AND 30 OR p_action_id IS NOT NULL)) OR
     (p_decision='rejected' AND (p_snooze_days IS NOT NULL OR p_action_id IS NOT NULL)) OR
     (p_decision='action_created' AND (p_snooze_days IS NOT NULL OR p_action_id IS NULL OR p_action_id < 1)) THEN
    RAISE EXCEPTION 'Invalid proactive coach decision' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_person FROM public.persons
    WHERE id=p_person_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proactive coach Person is unavailable' USING ERRCODE='23503'; END IF;

  IF p_source_type='commitment_due' AND NOT EXISTS (
    SELECT 1 FROM public.commitments c WHERE c.id=p_source_id AND c.person_id=p_person_id AND c.status='open'
  ) THEN RAISE EXCEPTION 'Proactive coach commitment is unavailable' USING ERRCODE='23503'; END IF;
  IF p_source_type='relationship_decay' AND p_source_id<>p_person_id THEN
    RAISE EXCEPTION 'Invalid relationship cadence source' USING ERRCODE='22023';
  END IF;
  IF p_source_type='relationship_changed' AND NOT EXISTS (
    SELECT 1 FROM public.relationships r WHERE r.id=p_source_id AND r.deleted_at IS NULL AND
      r.status='confirmed' AND (r.from_person_id=p_person_id OR r.to_person_id=p_person_id)
  ) THEN RAISE EXCEPTION 'Proactive coach relationship is unavailable' USING ERRCODE='23503'; END IF;
  IF p_source_type='activity_followup' AND NOT EXISTS (
    SELECT 1 FROM public.activity_participants ap JOIN public.activities a ON a.id=ap.activity_id
    WHERE ap.id=p_source_id AND ap.deleted_at IS NULL AND ap.canonical_person_id=p_person_id
      AND a.deleted_at IS NULL AND a.status IN ('ended','reviewed')
  ) THEN RAISE EXCEPTION 'Proactive coach activity participant is unavailable' USING ERRCODE='23503'; END IF;
  IF p_source_type='recruit_stagnation' AND NOT EXISTS (
    SELECT 1 FROM public.recruit_candidates rc WHERE rc.id=p_source_id AND rc.person_id=p_person_id
      AND rc.deleted_at IS NULL AND rc.stage<>'签约入司'
  ) THEN RAISE EXCEPTION 'Proactive coach recruit candidate is unavailable' USING ERRCODE='23503'; END IF;

  IF p_decision='action_created' AND NOT EXISTS (
    SELECT 1 FROM public.actions a WHERE a.id=p_action_id AND a.person_id=p_person_id
      AND a.created_by_uid=p_actor_uid AND a.description LIKE '%PC30:'||p_candidate_key::text||'%'
  ) THEN RAISE EXCEPTION 'Proactive coach Action is unavailable' USING ERRCODE='23503'; END IF;

  SELECT * INTO v_saved FROM public.crm_proactive_coach_decisions
    WHERE candidate_key=p_candidate_key FOR UPDATE;
  IF FOUND THEN
    IF v_saved.actor_uid<>p_actor_uid OR v_saved.person_id<>p_person_id OR
       v_saved.source_type<>p_source_type OR v_saved.source_id<>p_source_id THEN
      RAISE EXCEPTION 'Proactive coach candidate binding changed' USING ERRCODE='22023';
    END IF;
    IF v_saved.decision='rejected' OR v_saved.decision='action_created' THEN
      IF v_saved.decision=p_decision AND v_saved.action_id IS NOT DISTINCT FROM p_action_id THEN
        RETURN jsonb_build_object('ok',true,'candidateKey',p_candidate_key,
          'decision',v_saved.decision,'snoozeUntil',v_saved.snooze_until,
          'actionId',v_saved.action_id,'replayed',true);
      END IF;
      RAISE EXCEPTION 'Proactive coach candidate is already resolved' USING ERRCODE='40001';
    END IF;
    UPDATE public.crm_proactive_coach_decisions SET decision=p_decision,
      snooze_until=CASE WHEN p_decision='deferred' THEN now()+make_interval(days=>p_snooze_days) END,
      action_id=p_action_id,updated_at=now() WHERE candidate_key=p_candidate_key RETURNING * INTO v_saved;
  ELSE
    INSERT INTO public.crm_proactive_coach_decisions(candidate_key,actor_uid,person_id,source_type,source_id,
      decision,snooze_until,action_id)
    VALUES(p_candidate_key,p_actor_uid,p_person_id,p_source_type,p_source_id,p_decision,
      CASE WHEN p_decision='deferred' THEN now()+make_interval(days=>p_snooze_days) END,p_action_id)
    RETURNING * INTO v_saved;
  END IF;
  RETURN jsonb_build_object('ok',true,'candidateKey',v_saved.candidate_key,
    'decision',v_saved.decision,'snoozeUntil',v_saved.snooze_until,
    'actionId',v_saved.action_id,'replayed',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_proactive_coach_decision_v1(text,uuid,bigint,text,bigint,text,integer,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_proactive_coach_decision_v1(text,uuid,bigint,text,bigint,text,integer,bigint)
  TO service_role;
COMMENT ON TABLE public.crm_proactive_coach_decisions IS
  'PC30 human review state only; candidate source facts remain live and are never copied here';
NOTIFY pgrst,'reload schema';
COMMIT;
