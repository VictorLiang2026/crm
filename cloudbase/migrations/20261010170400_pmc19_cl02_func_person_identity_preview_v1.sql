CREATE OR REPLACE FUNCTION public.person_identity_preview_v1(p_actor_uid text, p_idempotency_key uuid, p_kind text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_id uuid; v_existing public.person_identity_commands%ROWTYPE;
  v_name text;v_name_key text;v_person_id bigint;v_person public.persons%ROWTYPE;
  v_fingerprint text;v_preview jsonb;v_customer_id bigint;v_recruit_id bigint;v_speaker_id bigint;
  v_customer_deleted boolean := false;
BEGIN
  IF current_user<>'service_role' OR nullif(btrim(p_actor_uid),'') IS NULL
     OR p_kind NOT IN ('person','customer','recruit','speaker','capture')
     OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'Invalid identity command'; END IF;
  SELECT * INTO v_existing FROM public.person_identity_commands
    WHERE actor_uid=p_actor_uid AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.kind<>p_kind OR v_existing.payload<>p_payload THEN
      RAISE EXCEPTION 'Idempotency key belongs to another command'; END IF;
    RETURN jsonb_build_object('previewId',v_existing.id,'preview',v_existing.preview,
      'expiresAt',v_existing.expires_at,'status',v_existing.status,'result',v_existing.result);
  END IF;
  v_name:=btrim(p_payload->>'display_name');
  v_name_key:=p_payload->>'name_key';
  IF length(v_name) NOT BETWEEN 1 AND 160 OR length(v_name_key) NOT BETWEEN 1 AND 160
     OR v_name_key<>lower(v_name_key) THEN RAISE EXCEPTION 'Invalid Person name'; END IF;
  v_person_id:=nullif(p_payload->>'person_id','')::bigint;
  IF v_person_id IS NOT NULL THEN
    SELECT * INTO v_person FROM public.persons WHERE id=v_person_id AND deleted_at IS NULL;
    IF NOT FOUND OR v_person.name_key<>v_name_key OR v_person.display_name<>v_name THEN
      RAISE EXCEPTION 'Selected Person changed; resolve identity again'; END IF;
  ELSIF p_kind IN ('customer','recruit') THEN
    RAISE EXCEPTION 'Selected Person is required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.persons WHERE display_name=v_name AND deleted_at IS NOT NULL)
     AND v_person_id IS NULL THEN RAISE EXCEPTION 'Deleted identity requires manual review'; END IF;
  SELECT md5(coalesce(string_agg(id::text||':'||updated_at::text,',' ORDER BY id),''))
    INTO v_fingerprint FROM public.persons WHERE name_key=v_name_key AND deleted_at IS NULL;
  IF v_person_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.persons WHERE name_key=v_name_key AND deleted_at IS NULL)
       AND (v_name !~ '(（[^（）]+）|\([^()]+\))$'
         OR EXISTS (SELECT 1 FROM public.persons WHERE display_name=v_name AND deleted_at IS NULL))
    THEN RAISE EXCEPTION 'Same-name Person requires explicit identity review and qualifier'; END IF;
  END IF;
  -- PMC-19 CL-02: query customer by person_id (customers 副本列已退出)
  IF v_person_id IS NOT NULL THEN
    SELECT "Id", deleted_at IS NOT NULL INTO v_customer_id, v_customer_deleted
    FROM public.customers WHERE person_id=v_person_id ORDER BY deleted_at NULLS FIRST LIMIT 1;
  END IF;
  IF p_kind='customer' OR (p_kind='capture' AND coalesce((p_payload->>'customer')::boolean,false)) THEN
    IF v_person_id IS NOT NULL AND v_customer_id IS NOT NULL THEN
      IF v_customer_deleted THEN
        RAISE EXCEPTION 'Customer is in recycle bin; restore it first';
      END IF;
    END IF;
  END IF;
  IF v_person_id IS NOT NULL THEN
    SELECT id INTO v_recruit_id FROM public.recruit_candidates
      WHERE person_id=v_person_id AND deleted_at IS NULL ORDER BY id LIMIT 1;
  END IF;
  IF p_payload ? 'speaker_id' THEN
    SELECT id INTO v_speaker_id FROM public.activity_speakers
      WHERE id=(p_payload->>'speaker_id')::bigint AND deleted_at IS NULL
        AND name=v_name AND customer_id IS NULL
        AND (person_id IS NULL OR person_id=v_person_id);
    IF v_speaker_id IS NULL THEN RAISE EXCEPTION 'Speaker profile changed; review again'; END IF;
  END IF;
  v_preview:=jsonb_build_object('kind',p_kind,'personId',v_person_id,
    'displayName',v_name,'newPerson',v_person_id IS NULL,
    'customerId',CASE WHEN p_kind='customer' OR coalesce((p_payload->>'customer')::boolean,false)
      THEN v_customer_id ELSE NULL END,'recruitId',v_recruit_id,
    'willCreateCustomer',p_kind='customer' OR coalesce((p_payload->>'customer')::boolean,false),
    'willCreateRecruit',p_kind='recruit','willCreateSpeaker',p_kind='speaker' OR coalesce((p_payload->>'speaker')::boolean,false),
    'speakerId',v_speaker_id,'willCreateInteraction',p_kind='capture');
  INSERT INTO public.person_identity_commands(actor_uid,idempotency_key,kind,payload,
    candidate_fingerprint,preview) VALUES(p_actor_uid,p_idempotency_key,p_kind,p_payload,
    v_fingerprint,v_preview) RETURNING id INTO v_id;
  RETURN jsonb_build_object('previewId',v_id,'preview',v_preview,
    'expiresAt',now()+interval '15 minutes','status','preview');
END
$function$;
