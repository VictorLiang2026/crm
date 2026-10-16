BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.crm_recruit_candidate_create_v1(
  p_actor_uid text,
  p_person_id bigint,
  p_selected_display_name text,
  p_operator text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $create$
DECLARE
  v_person public.persons%ROWTYPE;
  v_customer_id bigint;
  v_candidate_id bigint;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NULLIF(btrim(p_actor_uid), '') IS NULL OR p_person_id IS NULL OR p_person_id < 1 OR
     NULLIF(btrim(p_selected_display_name), '') IS NULL THEN
    RAISE EXCEPTION 'Invalid recruit candidate identity';
  END IF;

  SELECT * INTO v_person
  FROM public.persons
  WHERE id = p_person_id AND deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND OR v_person.display_name IS DISTINCT FROM p_selected_display_name THEN
    RAISE EXCEPTION 'Selected Person changed; resolve identity again';
  END IF;

  SELECT c."Id" INTO v_customer_id
  FROM public.customers AS c
  WHERE c.person_id = p_person_id AND c.deleted_at IS NULL
  ORDER BY c."Id"
  LIMIT 1;

  INSERT INTO public.recruit_candidates (
    customer_id, person_id, stage, stage_changed_at, operator, created_at, updated_at
  ) VALUES (
    v_customer_id, p_person_id, '新增人才', v_now,
    NULLIF(btrim(p_operator), ''), v_now, v_now
  )
  RETURNING id INTO v_candidate_id;

  INSERT INTO public.recruit_milestones (
    candidate_id, from_stage, to_stage, happened_at, note, operator, created_at
  ) VALUES (
    v_candidate_id, NULL, '新增人才', v_now, '创建候选人',
    NULLIF(btrim(p_operator), ''), v_now
  );

  RETURN jsonb_build_object(
    'id', v_candidate_id::text,
    'personId', p_person_id::text,
    'customerId', v_customer_id::text
  );
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Person already has an active recruit candidate';
END;
$create$;

CREATE FUNCTION public.crm_recruit_candidate_transition_v1(
  p_actor_uid text,
  p_candidate_id bigint,
  p_person_id bigint,
  p_expected_updated_at timestamptz,
  p_to_stage text,
  p_note text DEFAULT NULL,
  p_operator text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $transition$
DECLARE
  v_current public.recruit_candidates%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_stages constant text[] := ARRAY[
    '新增人才', '互动暖客', '初次面谈', '增员活动',
    '精准面谈', '入职申请', '签约入司', '流失'
  ];
BEGIN
  IF NULLIF(btrim(p_actor_uid), '') IS NULL OR p_candidate_id IS NULL OR p_candidate_id < 1 OR
     p_person_id IS NULL OR p_person_id < 1 OR p_expected_updated_at IS NULL OR
     p_to_stage IS NULL OR NOT (p_to_stage = ANY(v_stages)) THEN
    RAISE EXCEPTION 'Invalid recruit stage transition';
  END IF;

  SELECT * INTO v_current
  FROM public.recruit_candidates
  WHERE id = p_candidate_id AND person_id = p_person_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recruit candidate not found';
  END IF;
  IF v_current.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'conflict', true, 'code', 'RECRUIT_CONFLICT');
  END IF;
  IF v_current.stage = p_to_stage THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'stage', v_current.stage,
      'updatedAt', v_current.updated_at);
  END IF;

  UPDATE public.recruit_candidates
  SET stage = p_to_stage, stage_changed_at = v_now, updated_at = v_now,
      operator = COALESCE(NULLIF(btrim(p_operator), ''), operator)
  WHERE id = p_candidate_id;

  INSERT INTO public.recruit_milestones (
    candidate_id, from_stage, to_stage, happened_at, note, operator, created_at
  ) VALUES (
    p_candidate_id, v_current.stage, p_to_stage, v_now,
    NULLIF(btrim(p_note), ''), NULLIF(btrim(p_operator), ''), v_now
  );

  RETURN jsonb_build_object('ok', true, 'changed', true, 'stage', p_to_stage,
    'updatedAt', v_now);
END;
$transition$;

REVOKE ALL ON FUNCTION public.crm_recruit_candidate_create_v1(text,bigint,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_recruit_candidate_transition_v1(text,bigint,bigint,timestamptz,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruit_candidate_create_v1(text,bigint,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_recruit_candidate_transition_v1(text,bigint,bigint,timestamptz,text,text,text)
  TO service_role;

COMMENT ON FUNCTION public.crm_recruit_candidate_create_v1(text,bigint,text,text) IS
  'PC19: create a candidate only for a Person re-resolved by the authenticated server; existing customer links are reused, no customer role is created.';
COMMENT ON FUNCTION public.crm_recruit_candidate_transition_v1(text,bigint,bigint,timestamptz,text,text,text) IS
  'PC19: atomically transition a candidate and append its stage milestone with optimistic concurrency.';

COMMIT;
