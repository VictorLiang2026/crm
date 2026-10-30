BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.crm_person_interaction_v1(p_operation text,p_actor_uid text,p_person_id bigint,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE i public.interactions%ROWTYPE; f public.followups%ROWTYPE; c public.customers%ROWTYPE;
  person_name text; token text; iid bigint; rid uuid; fp text; moment timestamptz; date_precision text;
BEGIN
  IF current_user<>'service_role' OR NULLIF(btrim(p_actor_uid),'') IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object'
    OR p_operation NOT IN ('get','save','remove') THEN RAISE EXCEPTION 'INTERACTION_ACCESS_DENIED'; END IF;
  SELECT display_name INTO person_name FROM public.persons WHERE id=p_person_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'INTERACTION_PERSON_NOT_FOUND'; END IF;
  iid := (p_data->>'id')::bigint;
  IF iid IS NOT NULL THEN
    -- Same lock order as old followup writers: extension first, ledger second.
    SELECT * INTO f FROM public.followups WHERE interaction_id=iid FOR UPDATE;
    SELECT * INTO i FROM public.interactions WHERE id=iid AND person_id=p_person_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR i.source_type NOT IN ('manual','followups') THEN RAISE EXCEPTION 'INTERACTION_NOT_EDITABLE'; END IF;
    IF i.source_type='followups' AND (f."Id" IS NULL OR f.deleted_at IS NOT NULL OR
      NOT EXISTS(SELECT 1 FROM public.customers WHERE "Id"=f.customer_id AND person_id=p_person_id AND deleted_at IS NULL))
      THEN RAISE EXCEPTION 'INTERACTION_NOT_EDITABLE'; END IF;
    token := md5(to_jsonb(i)::text || COALESCE(to_jsonb(f)::text,''));
    IF p_operation='get' THEN RETURN jsonb_build_object('interaction',to_jsonb(i),'followup',CASE WHEN f."Id" IS NULL THEN NULL ELSE to_jsonb(f) END,'version',token); END IF;
    IF p_data->>'version' IS DISTINCT FROM token THEN RAISE EXCEPTION 'INTERACTION_STALE'; END IF;
    IF p_operation='remove' THEN
      IF i.source_type<>'followups' THEN RAISE EXCEPTION 'INTERACTION_NOT_EDITABLE'; END IF;
      DELETE FROM public.followups WHERE "Id"=f."Id";
      RETURN jsonb_build_object('ok',true);
    END IF;
  ELSIF p_operation<>'save' THEN RAISE EXCEPTION 'INTERACTION_NOT_FOUND';
  ELSE
    rid := (p_data->>'requestKey')::uuid;
    IF rid IS NULL THEN RAISE EXCEPTION 'INTERACTION_REQUEST_REQUIRED'; END IF;
    fp := md5(p_person_id::text || p_data::text);
    PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_uid || rid::text,0));
    SELECT * INTO i FROM public.interactions WHERE created_by_uid=p_actor_uid AND request_key=rid;
    IF FOUND THEN
      IF i.person_id<>p_person_id OR i.request_fingerprint IS DISTINCT FROM fp THEN RAISE EXCEPTION 'INTERACTION_REQUEST_CONFLICT'; END IF;
      RETURN jsonb_build_object('ok',true,'interaction',to_jsonb(i),'replayed',true);
    END IF;
  END IF;
  IF NULLIF(btrim(p_data->>'summary'),'') IS NULL OR length(p_data->>'summary')>2000
    OR length(p_data->>'raw_note')>10000 OR length(p_data->>'channel')>100
    OR COALESCE(p_data->>'interaction_type','') NOT IN ('meeting','call','message','note','followup')
    THEN RAISE EXCEPTION 'INTERACTION_INVALID_INPUT'; END IF;
  moment := (p_data->>'interaction_at')::timestamptz;
  date_precision := COALESCE(p_data->>'time_precision','instant');
  IF date_precision NOT IN ('instant','day','unknown') OR
    (moment IS NULL AND (iid IS NULL OR i.interaction_at IS NOT NULL OR date_precision<>'unknown')) OR
    (moment IS NOT NULL AND (date_precision='unknown' OR (p_data->>'interaction_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'))
    THEN RAISE EXCEPTION 'INTERACTION_INVALID_TIME'; END IF;
  IF p_data->>'activity_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.activities WHERE id=(p_data->>'activity_id')::bigint AND deleted_at IS NULL)
    THEN RAISE EXCEPTION 'INTERACTION_ACTIVITY_NOT_FOUND'; END IF;
  IF iid IS NULL THEN
    IF p_data->>'customer_id' IS NOT NULL THEN
      SELECT * INTO c FROM public.customers WHERE "Id"=(p_data->>'customer_id')::bigint AND person_id=p_person_id AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'INTERACTION_CUSTOMER_MISMATCH'; END IF;
      INSERT INTO public.followups(customer_id,customer_name,followup_date,interaction_summary,followup_notes,created_at)
        VALUES(c."Id",person_name,(moment AT TIME ZONE 'Asia/Shanghai')::date,p_data->>'summary',p_data->>'raw_note',clock_timestamp()) RETURNING * INTO f;
      iid:=f.interaction_id;
    ELSE
      INSERT INTO public.interactions(person_id,interaction_type,interaction_at,summary,source_type,created_by_uid)
        VALUES(p_person_id,p_data->>'interaction_type',moment,p_data->>'summary','manual',p_actor_uid) RETURNING id INTO iid;
    END IF;
  ELSE
    IF (p_data->>'customer_id')::bigint IS DISTINCT FROM f.customer_id::bigint THEN RAISE EXCEPTION 'INTERACTION_CONTEXT_IMMUTABLE'; END IF;
  END IF;
  IF f."Id" IS NOT NULL THEN
    IF length(p_data->>'next_followup_goal')>1000 OR length(p_data->>'next_action')>1000 THEN RAISE EXCEPTION 'INTERACTION_INVALID_INPUT'; END IF;
    IF p_data->>'recommendation_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ai_recommendations
      WHERE id=(p_data->>'recommendation_id')::bigint AND customer_id=f.customer_id) THEN RAISE EXCEPTION 'INTERACTION_RECOMMENDATION_MISMATCH'; END IF;
    UPDATE public.followups SET next_followup_date=(p_data->>'next_followup_date')::date,
      next_followup_goal=p_data->>'next_followup_goal', next_action=p_data->>'next_action',next_action_date=(p_data->>'next_action_date')::date,
      recommendation_id=(p_data->>'recommendation_id')::integer,updated_at=clock_timestamp() AT TIME ZONE 'Asia/Shanghai' WHERE "Id"=f."Id";
  END IF;
  UPDATE public.interactions SET interaction_type=p_data->>'interaction_type',interaction_at=moment,time_precision=date_precision,
    channel=p_data->>'channel',summary=btrim(p_data->>'summary'),raw_note=p_data->>'raw_note',activity_id=(p_data->>'activity_id')::bigint,
    updated_at=clock_timestamp(),created_by_uid=COALESCE(created_by_uid,p_actor_uid),
    request_key=COALESCE(request_key,rid),request_fingerprint=COALESCE(request_fingerprint,fp)
    WHERE id=iid RETURNING * INTO i;
  RETURN jsonb_build_object('ok',true,'interaction',to_jsonb(i));
END $$;
REVOKE ALL ON FUNCTION public.crm_person_interaction_v1(text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_person_interaction_v1(text,text,bigint,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
