-- PC32-D rollback stops if existing-Person capture receipts need data review.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.person_identity_commands WHERE kind='capture_v2_existing') THEN
   RAISE EXCEPTION 'PC32-D receipts exist; assess data before rollback'; END IF;
 IF md5(pg_get_functiondef('public.person_identity_preview_v1(text,uuid,text,jsonb)'::regprocedure))<>'420d9f7585b1b3c1c0b8ee89bdd33f08'
 OR md5(pg_get_functiondef('public.person_identity_execute_v1(text,uuid)'::regprocedure))<>'6bfc7224f04de2e4295ea095d5cc23e2'
 THEN RAISE EXCEPTION 'PC32-D function changed after migration'; END IF;
END $guard$;
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
     OR p_kind NOT IN ('person','customer','recruit','speaker','capture','capture_v2_new')
     OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'Invalid identity command'; END IF;
  IF p_kind='capture_v2_new' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('capture_v2:'||p_idempotency_key::text,0));
    IF EXISTS(SELECT 1 FROM public.person_identity_commands
      WHERE idempotency_key=p_idempotency_key AND kind='capture_v2_new'
        AND actor_uid<>p_actor_uid) THEN
      RAISE EXCEPTION 'Idempotency key belongs to another account'; END IF;
  END IF;
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
  IF p_kind='capture_v2_new' AND p_payload ? 'person_id' THEN
    RAISE EXCEPTION 'New Person capture cannot select an existing Person'; END IF;
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
  IF p_kind='capture_v2_new' THEN
    IF p_payload->>'source' IS DISTINCT FROM '人工新增' OR
       EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) AS k
         WHERE k NOT IN ('display_name','name_key','occupation','organization',
           'education','source','interaction','facts','signals')) OR
       jsonb_typeof(p_payload->'interaction') IS DISTINCT FROM 'object' OR
       jsonb_typeof(p_payload->'facts') IS DISTINCT FROM 'array' OR
       jsonb_typeof(p_payload->'signals') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid Quick Capture preview'; END IF;
    IF jsonb_array_length(p_payload->'facts')>20 OR
       jsonb_array_length(p_payload->'signals')>12 OR
       length(coalesce(p_payload->>'occupation',''))>120 OR
       length(coalesce(p_payload->>'organization',''))>120 OR
       length(coalesce(p_payload->>'education',''))>120 THEN
      RAISE EXCEPTION 'Invalid Quick Capture preview'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload->'interaction') AS k
      WHERE k NOT IN ('type','at','channel','summary','rawNote')) OR
       jsonb_typeof(p_payload->'interaction'->'type') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_payload->'interaction'->'at') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_payload->'interaction'->'channel') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_payload->'interaction'->'summary') IS DISTINCT FROM 'string' OR
       jsonb_typeof(p_payload->'interaction'->'rawNote') IS DISTINCT FROM 'string' OR
       length(btrim(coalesce(p_payload->'interaction'->>'type',''))) NOT BETWEEN 1 AND 64 OR
       coalesce(p_payload->'interaction'->>'at','') !~
         '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$' OR
       length(coalesce(p_payload->'interaction'->>'channel',''))>100 OR
       length(btrim(coalesce(p_payload->'interaction'->>'summary',''))) NOT BETWEEN 1 AND 2000 OR
       length(btrim(coalesce(p_payload->'interaction'->>'rawNote','')))=0 OR
       length(p_payload->'interaction'->>'rawNote')>10000 THEN
      RAISE EXCEPTION 'Invalid Interaction candidate'; END IF;
    PERFORM (p_payload->'interaction'->>'at')::timestamptz;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'facts') AS item(value)
        WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string' OR
          length(btrim(item.value #>> '{}')) NOT BETWEEN 1 AND 500) OR
       EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'signals') AS item(value)
        WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string' OR
          length(btrim(item.value #>> '{}')) NOT BETWEEN 1 AND 500) THEN
      RAISE EXCEPTION 'Invalid Context Item candidate'; END IF;
  END IF;
  v_preview:=jsonb_build_object('kind',p_kind,'personId',v_person_id,
    'displayName',v_name,'newPerson',v_person_id IS NULL,
    'customerId',CASE WHEN p_kind='customer' OR coalesce((p_payload->>'customer')::boolean,false)
      THEN v_customer_id ELSE NULL END,'recruitId',v_recruit_id,
    'willCreateCustomer',p_kind='customer' OR coalesce((p_payload->>'customer')::boolean,false),
    'willCreateRecruit',p_kind='recruit','willCreateSpeaker',p_kind='speaker' OR coalesce((p_payload->>'speaker')::boolean,false),
    'speakerId',v_speaker_id,'willCreateInteraction',p_kind IN ('capture','capture_v2_new'));
  IF p_kind='capture_v2_new' THEN
    v_preview:=v_preview||jsonb_build_object('interaction',p_payload->'interaction',
      'facts',p_payload->'facts','signals',p_payload->'signals');
  END IF;
  INSERT INTO public.person_identity_commands(actor_uid,idempotency_key,kind,payload,
    candidate_fingerprint,preview) VALUES(p_actor_uid,p_idempotency_key,p_kind,p_payload,
    v_fingerprint,v_preview) RETURNING id INTO v_id;
  RETURN jsonb_build_object('previewId',v_id,'preview',v_preview,
    'expiresAt',now()+interval '15 minutes','status','preview');
END
$function$
;
CREATE OR REPLACE FUNCTION public.person_identity_execute_v1(p_actor_uid text, p_preview_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_cmd public.person_identity_commands%ROWTYPE;v_person public.persons%ROWTYPE;
  v_name_key text;v_fingerprint text;v_customer_id bigint;v_recruit_id bigint;
  v_speaker_id bigint;v_interaction_id bigint;v_result jsonb;v_parent_id text;v_capture_result jsonb;
BEGIN
  IF current_user<>'service_role' OR nullif(btrim(p_actor_uid),'') IS NULL THEN
    RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cmd FROM public.person_identity_commands
    WHERE id=p_preview_id AND actor_uid=p_actor_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Preview not found for this account'; END IF;
  IF v_cmd.status='executed' THEN RETURN v_cmd.result; END IF;
  IF v_cmd.expires_at<=now() THEN RAISE EXCEPTION 'Preview expired'; END IF;
  v_name_key:=v_cmd.payload->>'name_key';
  PERFORM pg_advisory_xact_lock(hashtextextended(v_name_key,0));
  SELECT md5(coalesce(string_agg(id::text||':'||updated_at::text,',' ORDER BY id),''))
    INTO v_fingerprint FROM public.persons WHERE name_key=v_name_key AND deleted_at IS NULL;
  IF v_fingerprint<>v_cmd.candidate_fingerprint THEN
    RAISE EXCEPTION 'Identity candidates changed; preview again'; END IF;
  IF v_cmd.payload ? 'person_id' AND nullif(v_cmd.payload->>'person_id','') IS NOT NULL THEN
    SELECT * INTO v_person FROM public.persons
      WHERE id=(v_cmd.payload->>'person_id')::bigint AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_person.display_name<>v_cmd.payload->>'display_name'
       OR v_person.name_key<>v_name_key THEN
      RAISE EXCEPTION 'Selected Person changed; preview again'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.persons WHERE display_name=v_cmd.payload->>'display_name'
      AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Deleted identity requires manual review'; END IF;
    IF EXISTS (SELECT 1 FROM public.persons WHERE name_key=v_name_key AND deleted_at IS NULL)
       AND ((v_cmd.payload->>'display_name') !~ '(（[^（）]+）|\([^()]+\))$'
         OR EXISTS (SELECT 1 FROM public.persons WHERE display_name=v_cmd.payload->>'display_name'
            AND deleted_at IS NULL)) THEN
      RAISE EXCEPTION 'Same-name Person changed; preview again'; END IF;
    IF EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid)
       AND position('【系统测试·勿联系】' IN (v_cmd.payload->>'display_name'))=0 THEN
      RAISE EXCEPTION 'Test account must use fictional marked Person'; END IF;
    INSERT INTO public.persons(display_name,name_key,occupation,organization,education,source)
      VALUES(v_cmd.payload->>'display_name',v_name_key,
        nullif(v_cmd.payload->>'occupation',''),nullif(v_cmd.payload->>'organization',''),
        nullif(v_cmd.payload->>'education',''),
        coalesce(nullif(v_cmd.payload->>'source',''),'人工新增')) RETURNING * INTO v_person;
    IF EXISTS(SELECT 1 FROM public.crm_test_batches WHERE created_by_uid=p_actor_uid) THEN
      SELECT record_id INTO v_parent_id FROM public.crm_test_records
        WHERE batch_key='crm_test_main_v1' AND record_table='persons'
        ORDER BY created_at LIMIT 1;
      IF v_parent_id IS NULL THEN RAISE EXCEPTION 'Test parent Person is missing'; END IF;
      INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,
        parent_table,parent_id,visible_label)
      VALUES('crm_test_main_v1','persons',v_person.id::text,'derived',
        'persons',v_parent_id,'【系统测试·勿联系】WP07.1 人工新增人物');
    END IF;
  END IF;
  -- PMC-19 CL-02: query customer by person_id (customers 副本列已退出)
  SELECT "Id" INTO v_customer_id FROM public.customers
    WHERE person_id=v_person.id AND deleted_at IS NULL;
  IF v_customer_id IS NULL AND EXISTS (SELECT 1 FROM public.customers
    WHERE person_id=v_person.id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Customer is in recycle bin; restore it first'; END IF;
  IF v_cmd.kind='customer' OR
     (v_cmd.kind='capture' AND coalesce((v_cmd.payload->>'customer')::boolean,false)) THEN
    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers(person_id)
      VALUES(v_person.id)
      RETURNING "Id" INTO v_customer_id;
      IF EXISTS(SELECT 1 FROM public.crm_test_records
        WHERE record_table='persons' AND record_id=v_person.id::text) THEN
        INSERT INTO public.crm_test_records(batch_key,record_table,record_id,origin,
          parent_table,parent_id,visible_label)
        SELECT batch_key,'customers',v_customer_id::text,'derived','persons',
          v_person.id::text,'【系统测试·勿联系】WP07.1 转客户'
        FROM public.crm_test_records WHERE record_table='persons'
          AND record_id=v_person.id::text ON CONFLICT DO NOTHING;
      END IF;
      UPDATE public.recruit_candidates SET customer_id=v_customer_id,updated_at=now()
        WHERE person_id=v_person.id AND customer_id IS NULL AND deleted_at IS NULL;
    END IF;
    INSERT INTO public.person_roles(person_id,role,origin)
      VALUES(v_person.id,'customer','manual') ON CONFLICT(person_id,role) DO NOTHING;
  END IF;
  IF v_cmd.kind='recruit' THEN
    SELECT id INTO v_recruit_id FROM public.recruit_candidates
      WHERE person_id=v_person.id AND deleted_at IS NULL;
    IF v_recruit_id IS NULL THEN
      INSERT INTO public.recruit_candidates(person_id,customer_id,stage,stage_changed_at)
      VALUES(v_person.id,v_customer_id,'新增人才',now()) RETURNING id INTO v_recruit_id;
      INSERT INTO public.recruit_milestones(candidate_id,from_stage,to_stage,note)
        VALUES(v_recruit_id,NULL,'新增人才','人工转增员');
    END IF;
    INSERT INTO public.person_roles(person_id,role,origin)
      VALUES(v_person.id,'recruit','manual') ON CONFLICT(person_id,role) DO NOTHING;
  END IF;
  IF v_cmd.kind IN ('speaker','capture') THEN
    IF v_cmd.kind='speaker' OR coalesce((v_cmd.payload->>'speaker')::boolean,false) THEN
      IF v_cmd.payload ? 'speaker_id' THEN
        SELECT id INTO v_speaker_id FROM public.activity_speakers
          WHERE id=(v_cmd.payload->>'speaker_id')::bigint AND deleted_at IS NULL
            AND name=v_person.display_name AND customer_id IS NULL
            AND (person_id IS NULL OR person_id=v_person.id) FOR UPDATE;
        IF v_speaker_id IS NULL THEN RAISE EXCEPTION 'Speaker profile changed; preview again'; END IF;
        UPDATE public.activity_speakers SET person_id=v_person.id,customer_id=v_customer_id,
          updated_at=now() WHERE id=v_speaker_id AND person_id IS NULL;
        IF v_cmd.kind='capture' THEN
          UPDATE public.activity_speakers SET last_contact_date=current_date,
            last_contact_note='【快速记录】'||(v_cmd.payload->>'note'),
            next_contact_date=nullif(v_cmd.payload->>'next_contact_date','')::date,
            updated_at=now() WHERE id=v_speaker_id;
        END IF;
      ELSE
        SELECT id INTO v_speaker_id FROM public.activity_speakers
          WHERE person_id=v_person.id AND deleted_at IS NULL ORDER BY id LIMIT 1;
      END IF;
      IF v_speaker_id IS NULL THEN
        INSERT INTO public.activity_speakers(name,person_id,customer_id,
          last_contact_date,last_contact_note,next_contact_date)
          VALUES(v_person.display_name,v_person.id,v_customer_id,
            CASE WHEN v_cmd.kind='capture' THEN current_date ELSE NULL END,
            CASE WHEN v_cmd.kind='capture' THEN '【快速记录】'||(v_cmd.payload->>'note') ELSE NULL END,
            nullif(v_cmd.payload->>'next_contact_date','')::date)
          RETURNING id INTO v_speaker_id;
      END IF;
      INSERT INTO public.person_roles(person_id,role,origin)
        VALUES(v_person.id,'speaker','manual') ON CONFLICT(person_id,role) DO NOTHING;
    END IF;
  END IF;
  IF v_cmd.kind='capture' THEN
    IF length(btrim(coalesce(v_cmd.payload->>'note','')))=0
       OR length(v_cmd.payload->>'note')>10000 THEN
      RAISE EXCEPTION 'Invalid quick capture note'; END IF;
    INSERT INTO public.interactions(person_id,interaction_type,interaction_at,
      summary,raw_note,source_type,created_by_uid)
    VALUES(v_person.id,'交流',coalesce((v_cmd.payload->>'interaction_at')::timestamptz,now()),
      left(coalesce(nullif(v_cmd.payload->>'summary',''),v_cmd.payload->>'note'),2000),
      v_cmd.payload->>'note','manual',p_actor_uid) RETURNING id INTO v_interaction_id;
  END IF;
  IF v_cmd.kind='capture_v2_new' THEN
    IF v_cmd.payload ? 'person_id' THEN
      RAISE EXCEPTION 'New Person capture cannot select an existing Person'; END IF;
    v_capture_result:=public.quick_capture_v2_commit(v_person.id,
      v_cmd.payload->>'display_name',p_actor_uid,v_cmd.payload->'interaction',
      v_cmd.payload->'facts',v_cmd.payload->'signals');
    v_interaction_id:=(v_capture_result->>'interactionId')::bigint;
  END IF;
  v_result:=jsonb_build_object('personId',v_person.id,'customerId',v_customer_id,
    'recruitId',v_recruit_id,'speakerId',v_speaker_id,'interactionId',v_interaction_id,
    'replayed',false);
  IF v_cmd.kind='capture_v2_new' THEN
    v_result:=v_result||jsonb_build_object('contextItemCount',
      (v_capture_result->>'contextItemCount')::integer);
  END IF;
  UPDATE public.person_identity_commands SET status='executed',result=v_result,
    executed_at=now() WHERE id=v_cmd.id;
  RETURN v_result;
END
$function$
;
ALTER TABLE public.person_identity_commands
 DROP CONSTRAINT person_identity_commands_kind_check;
ALTER TABLE public.person_identity_commands
 ADD CONSTRAINT person_identity_commands_kind_check
 CHECK (kind IN ('person','customer','recruit','speaker','capture','capture_v2_new'));
COMMIT;