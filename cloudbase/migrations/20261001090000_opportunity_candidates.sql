-- AI suggestions are private drafts. Only an authenticated, preview-bound RPC may promote one.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF to_regclass('public.opportunity_candidates') IS NOT NULL OR
     to_regprocedure('public.opportunity_candidate_v1(text,text,bigint,bigint,bigint,jsonb,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Opportunity candidate objects already exist';
  END IF;
END $guard$;

CREATE TABLE public.opportunity_candidates (
  id bigserial PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES public.persons(id) ON DELETE RESTRICT,
  ai_result_id bigint NOT NULL UNIQUE REFERENCES public.ai_results(id) ON DELETE RESTRICT,
  created_by_uid text NOT NULL CHECK (length(btrim(created_by_uid)) BETWEEN 1 AND 128),
  reviewed_by_uid text,
  draft jsonb NOT NULL,
  evidence jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','previewed','confirmed','created','rejected')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  preview_json jsonb,
  preview_hash text,
  person_updated_at timestamptz,
  preview_expires_at timestamptz,
  confirmed_at timestamptz,
  opportunity_id bigint UNIQUE REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_candidate_state_check CHECK (
    (status IN ('draft','previewed','rejected') AND confirmed_at IS NULL AND opportunity_id IS NULL)
    OR (status = 'confirmed' AND reviewed_by_uid IS NOT NULL AND confirmed_at IS NOT NULL AND opportunity_id IS NULL)
    OR (status = 'created' AND reviewed_by_uid IS NOT NULL AND confirmed_at IS NOT NULL AND opportunity_id IS NOT NULL)
  )
);
CREATE INDEX opportunity_candidates_person_idx
  ON public.opportunity_candidates(person_id, created_at DESC, id DESC);
CREATE INDEX opportunity_candidates_pending_idx
  ON public.opportunity_candidates(status, preview_expires_at)
  WHERE status IN ('draft','previewed','confirmed');
ALTER TABLE public.opportunity_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_candidates_service_only ON public.opportunity_candidates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.opportunity_candidates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.opportunity_candidates TO service_role;
REVOKE ALL ON SEQUENCE public.opportunity_candidates_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.opportunity_candidates_id_seq TO service_role;

CREATE FUNCTION public.opportunity_candidate_v1(
  p_operation text, p_actor_uid text, p_candidate_id bigint DEFAULT NULL,
  p_person_id bigint DEFAULT NULL, p_ai_result_id bigint DEFAULT NULL,
  p_draft jsonb DEFAULT NULL, p_evidence jsonb DEFAULT NULL,
  p_preview_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $function$
DECLARE
  v_candidate public.opportunity_candidates%ROWTYPE;
  v_person public.persons%ROWTYPE;
  v_draft jsonb;
  v_ai jsonb;
  v_refs jsonb;
  v_preview jsonb;
  v_hash text;
  v_opportunity_id bigint;
BEGIN
  IF p_actor_uid IS NULL OR length(btrim(p_actor_uid)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='22023';
  END IF;
  IF p_operation NOT IN ('create','edit','reject','preview','confirm','execute') OR p_operation IS NULL THEN
    RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023';
  END IF;

  IF p_operation IN ('create','edit') THEN
    IF jsonb_typeof(p_draft) IS DISTINCT FROM 'object' OR
       (SELECT count(*) FROM jsonb_object_keys(p_draft)) <> 3 OR
       EXISTS (SELECT 1 FROM jsonb_object_keys(p_draft) k
         WHERE k NOT IN ('opportunity_type','reason','next_action')) OR
       p_draft->>'opportunity_type' NOT IN
         ('insurance','recruit','referral','activity','speaker','partnership','service','relationship') OR
       jsonb_typeof(p_draft->'reason') IS DISTINCT FROM 'string' OR
       length(btrim(p_draft->>'reason')) NOT BETWEEN 1 AND 1000 OR
       jsonb_typeof(p_draft->'next_action') IS DISTINCT FROM 'string' OR
       length(btrim(p_draft->>'next_action')) NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'Invalid candidate draft' USING ERRCODE='22023';
    END IF;
    v_draft := jsonb_build_object('opportunity_type',p_draft->>'opportunity_type',
      'reason',btrim(p_draft->>'reason'),'next_action',btrim(p_draft->>'next_action'));
  ELSIF p_draft IS NOT NULL THEN
    RAISE EXCEPTION 'Draft only accepted for create or edit' USING ERRCODE='22023';
  END IF;

  IF p_operation = 'create' THEN
    IF p_candidate_id IS NOT NULL OR p_preview_hash IS NOT NULL OR
       p_person_id IS NULL OR p_ai_result_id IS NULL OR
       jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR
       jsonb_array_length(p_evidence) NOT BETWEEN 1 AND 8 OR
       EXISTS (SELECT 1 FROM jsonb_array_elements(p_evidence) AS x(value)
         WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'string' OR
           (x.value#>>'{}') !~ '^public\.[a-z_]+#[1-9][0-9]*$') THEN
      RAISE EXCEPTION 'Invalid candidate evidence' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_person FROM public.persons
      WHERE id=p_person_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person not found' USING ERRCODE='23503'; END IF;
    SELECT r.result_json INTO v_ai FROM public.ai_results r
      JOIN public.ai_tasks t ON t.id=r.task_id
      WHERE r.id=p_ai_result_id AND t.subject_type='person'
        AND t.subject_id=p_person_id::text AND t.skill_name='opportunity_candidate'
        AND t.status='completed';
    IF NOT FOUND OR v_ai->>'status' <> 'candidate' OR
       v_ai->>'opportunityType' <> v_draft->>'opportunity_type' OR
       jsonb_typeof(v_ai->'sourceRefs') IS DISTINCT FROM 'array' OR
       v_ai->'sourceRefs' <> p_evidence THEN
      RAISE EXCEPTION 'AI result does not match candidate' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.opportunity_candidates
      (person_id,ai_result_id,created_by_uid,draft,evidence)
      VALUES (p_person_id,p_ai_result_id,p_actor_uid,v_draft,p_evidence)
      RETURNING * INTO v_candidate;
    RETURN jsonb_build_object('ok',true,'status','draft','candidateId',v_candidate.id,
      'version',v_candidate.version,'businessDataWritten',false);
  END IF;

  IF p_candidate_id IS NULL OR p_person_id IS NOT NULL OR p_ai_result_id IS NOT NULL OR
     p_evidence IS NOT NULL THEN
    RAISE EXCEPTION 'Candidate ID required without generation fields' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_candidate FROM public.opportunity_candidates
    WHERE id=p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found' USING ERRCODE='23503'; END IF;
  IF v_candidate.status='created' AND p_operation='execute' THEN
    RETURN jsonb_build_object('ok',true,'status','created','candidateId',v_candidate.id,
      'opportunityId',v_candidate.opportunity_id,'replayed',true,'businessDataWritten',false);
  END IF;
  IF p_operation <> 'confirm' AND p_preview_hash IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected preview hash' USING ERRCODE='22023';
  END IF;

  IF p_operation='edit' THEN
    IF v_candidate.status NOT IN ('draft','previewed') THEN
      RAISE EXCEPTION 'Candidate cannot be edited' USING ERRCODE='42501';
    END IF;
    UPDATE public.opportunity_candidates SET draft=v_draft, status='draft',
      version=version+1, preview_json=NULL, preview_hash=NULL,
      preview_expires_at=NULL, person_updated_at=NULL,
      reviewed_by_uid=p_actor_uid, updated_at=now()
      WHERE id=v_candidate.id RETURNING * INTO v_candidate;
    RETURN jsonb_build_object('ok',true,'status','draft','candidateId',v_candidate.id,
      'version',v_candidate.version,'businessDataWritten',false);
  END IF;
  IF p_operation='reject' THEN
    IF v_candidate.status NOT IN ('draft','previewed') THEN
      RAISE EXCEPTION 'Candidate cannot be rejected' USING ERRCODE='42501';
    END IF;
    UPDATE public.opportunity_candidates SET status='rejected',
      reviewed_by_uid=p_actor_uid, preview_json=NULL, preview_hash=NULL,
      preview_expires_at=NULL, updated_at=now()
      WHERE id=v_candidate.id;
    UPDATE public.ai_results SET user_selected=false, user_edited=false,
      feedback='rejected' WHERE id=v_candidate.ai_result_id;
    RETURN jsonb_build_object('ok',true,'status','rejected','candidateId',v_candidate.id,
      'businessDataWritten',false);
  END IF;
  IF p_operation='preview' THEN
    IF v_candidate.status NOT IN ('draft','previewed') THEN
      RAISE EXCEPTION 'Candidate cannot be previewed' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v_person FROM public.persons
      WHERE id=v_candidate.person_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person changed' USING ERRCODE='23503'; END IF;
    IF EXISTS (SELECT 1 FROM public.opportunities o
      WHERE o.person_id=v_candidate.person_id AND o.deleted_at IS NULL
        AND o.status NOT IN ('成交','关闭')
        AND o.opportunity_type=v_candidate.draft->>'opportunity_type'
        AND lower(btrim(coalesce(o.last_progress,'')))=
          lower(btrim(v_candidate.draft->>'reason'))) THEN
      RAISE EXCEPTION 'Matching Opportunity already exists' USING ERRCODE='23505';
    END IF;
    v_preview := jsonb_build_object('operation','create','resource','opportunities',
      'before',NULL,'after',v_candidate.draft,
      'person',jsonb_build_object('id',v_person.id,'displayName',v_person.display_name),
      'evidence',v_candidate.evidence,'existingDuplicate',false);
    v_hash := md5(v_candidate.id::text || p_actor_uid || v_candidate.draft::text ||
      v_candidate.evidence::text || coalesce(v_person.updated_at::text,'') ||
      (v_candidate.version+1)::text);
    UPDATE public.opportunity_candidates SET status='previewed', version=version+1,
      preview_json=v_preview, preview_hash=v_hash,
      preview_expires_at=now()+interval '15 minutes',
      person_updated_at=v_person.updated_at, reviewed_by_uid=p_actor_uid,
      updated_at=now() WHERE id=v_candidate.id RETURNING * INTO v_candidate;
    RETURN jsonb_build_object('ok',true,'status','previewed','candidateId',v_candidate.id,
      'version',v_candidate.version,'preview',v_preview,'previewHash',v_hash,
      'expiresAt',v_candidate.preview_expires_at,'businessDataWritten',false);
  END IF;
  IF p_operation='confirm' THEN
    IF v_candidate.status<>'previewed' OR v_candidate.reviewed_by_uid<>p_actor_uid OR
       p_preview_hash IS NULL OR p_preview_hash<>v_candidate.preview_hash OR
       length(p_preview_hash)<>32 OR v_candidate.preview_expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'Valid server preview and human confirmation required' USING ERRCODE='42501';
    END IF;
    UPDATE public.opportunity_candidates SET status='confirmed',
      confirmed_at=now(), updated_at=now() WHERE id=v_candidate.id;
    RETURN jsonb_build_object('ok',true,'status','confirmed','candidateId',v_candidate.id,
      'businessDataWritten',false);
  END IF;

  IF v_candidate.status<>'confirmed' OR v_candidate.reviewed_by_uid<>p_actor_uid OR
     v_candidate.preview_expires_at<=clock_timestamp() OR
     v_candidate.preview_hash IS NULL THEN
    RAISE EXCEPTION 'Confirmation required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_person FROM public.persons
    WHERE id=v_candidate.person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_person.updated_at IS DISTINCT FROM v_candidate.person_updated_at THEN
    RAISE EXCEPTION 'Person changed since preview' USING ERRCODE='40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.opportunities o
    WHERE o.person_id=v_candidate.person_id AND o.deleted_at IS NULL
      AND o.status NOT IN ('成交','关闭')
      AND o.opportunity_type=v_candidate.draft->>'opportunity_type'
      AND lower(btrim(coalesce(o.last_progress,'')))=
        lower(btrim(v_candidate.draft->>'reason'))) THEN
    RAISE EXCEPTION 'Matching Opportunity already exists' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.opportunities(person_id,customer_id,opportunity_type,status,
    discovered_at,last_progress,next_action,ai_summary)
    VALUES (v_candidate.person_id,NULL,v_candidate.draft->>'opportunity_type','发现',
      CURRENT_DATE,v_candidate.draft->>'reason',v_candidate.draft->>'next_action',
      '人工确认的 AI 机会候选 #' || v_candidate.id::text)
    RETURNING id INTO v_opportunity_id;
  UPDATE public.opportunity_candidates SET status='created', opportunity_id=v_opportunity_id,
    updated_at=now() WHERE id=v_candidate.id;
  SELECT result_json INTO v_ai FROM public.ai_results WHERE id=v_candidate.ai_result_id;
  UPDATE public.ai_results SET user_selected=true,
    user_edited=(v_candidate.draft->>'reason' IS DISTINCT FROM v_ai->>'reason' OR
      v_candidate.draft->>'next_action' IS DISTINCT FROM v_ai->>'nextAction' OR
      v_candidate.draft->>'opportunity_type' IS DISTINCT FROM v_ai->>'opportunityType'),
    final_result_json=v_candidate.draft, feedback='accepted'
    WHERE id=v_candidate.ai_result_id;
  RETURN jsonb_build_object('ok',true,'status','created','candidateId',v_candidate.id,
    'opportunityId',v_opportunity_id,'replayed',false,'businessDataWritten',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.opportunity_candidate_v1(text,text,bigint,bigint,bigint,jsonb,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.opportunity_candidate_v1(text,text,bigint,bigint,bigint,jsonb,jsonb,text)
  TO service_role;
COMMENT ON FUNCTION public.opportunity_candidate_v1(text,text,bigint,bigint,bigint,jsonb,jsonb,text) IS
  'Service-only candidate review and confirmed once-only promotion to public.opportunities.';
COMMIT;
