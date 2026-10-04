-- WP07.1: Person-owned identity, explicit roles and Person-only recruitment.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE public.recruit_candidates ALTER COLUMN customer_id DROP NOT NULL;
CREATE UNIQUE INDEX recruit_candidates_person_active_uq
  ON public.recruit_candidates(person_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX persons_display_name_active_uq
  ON public.persons(display_name) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.recruit_candidate_person_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $sync$
DECLARE v_customer public.customers%ROWTYPE; v_person_id bigint;
BEGIN
  IF NEW.customer_id IS NULL THEN
    IF NEW.person_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.persons p WHERE p.id=NEW.person_id AND p.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'Active Person is required for Person-only recruit'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.customer_id IS NULL
       AND NEW.person_id IS DISTINCT FROM OLD.person_id THEN
      RAISE EXCEPTION 'Candidate Person cannot be changed independently';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v_customer FROM public.customers WHERE "Id"=NEW.customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate customer does not exist'; END IF;
  SELECT id INTO v_person_id FROM public.persons WHERE legacy_customer_id=v_customer."Id";
  IF v_person_id IS NULL THEN
    INSERT INTO public.persons(display_name,name_key,phone,wechat,gender,birthday,
      occupation,organization,education,source,notes,legacy_customer_id,created_at,updated_at,deleted_at)
    VALUES(v_customer.customer_name,
      lower(regexp_replace(btrim(regexp_replace(translate(v_customer.customer_name,'　',' '),
        '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$','')),'[[:space:]]+',' ','g')),
      v_customer.phone,v_customer.wx_account,v_customer.gender,v_customer.birthday,
      v_customer.occupation,NULL,v_customer.education,v_customer.source,
      v_customer.additional_info,v_customer."Id",coalesce(v_customer.created_at,now()),
      coalesce(v_customer.updated_at,v_customer.created_at,now()),v_customer.deleted_at)
    ON CONFLICT (legacy_customer_id) DO NOTHING;
    SELECT id INTO v_person_id FROM public.persons WHERE legacy_customer_id=v_customer."Id";
  END IF;
  IF v_person_id IS NULL OR
     (NEW.person_id IS NOT NULL AND NEW.person_id<>v_person_id) THEN
    RAISE EXCEPTION 'Candidate Person does not match customer';
  END IF;
  NEW.person_id:=v_person_id;
  RETURN NEW;
END $sync$;

-- Preserve the old column order/types and grants. Person supplies identity only
-- when there is no customer compatibility record.
CREATE OR REPLACE VIEW public.v_recruit_candidates WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id, rc.customer_id, c.customer_name, c.gender,
       c.birthday, c.phone, c.wx_account, c.occupation, c.annual_income,
       c.education, c.mbti, c.source, c.marital_status, c.hobbies,
       c.additional_info, rc.recommender_id, rc.stage, rc.stage_changed_at,
       rc.potential_score, rc.potential_reason, rc.motivation, rc.concerns,
       rc.work_experience, rc.family_situation, rc.personality_tags,
       rc.career_plan, rc.next_action_date, rc.next_action, rc.activity_history,
       rc.radar_image_file_id, rc.radar_image_name, rc.winner_report_file_id,
       rc.winner_report_name, rc.operator, rc.created_at, rc.updated_at,
       CASE WHEN rc.stage_changed_at IS NOT NULL
            THEN EXTRACT(DAY FROM now() - rc.stage_changed_at)::integer
            ELSE NULL::integer END AS idle_days,
       rc.profile, rc.person_id
FROM public.recruit_candidates AS rc
JOIN public.customers AS c ON c."Id" = rc.customer_id
WHERE rc.deleted_at IS NULL AND c.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_recruit_candidates_trash WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id, rc.customer_id, c.customer_name, c.phone,
       c.occupation, rc.stage, rc.operator, rc.created_at, rc.updated_at,
       rc.deleted_at AS candidate_deleted_at, c.deleted_at AS customer_deleted_at,
       rc.person_id
FROM public.recruit_candidates AS rc
JOIN public.customers AS c ON c."Id" = rc.customer_id
WHERE rc.deleted_at IS NOT NULL;

REVOKE ALL ON public.v_recruit_candidates, public.v_recruit_candidates_trash
  FROM PUBLIC, authenticated;
GRANT SELECT ON public.v_recruit_candidates, public.v_recruit_candidates_trash
  TO anon, service_role;

CREATE OR REPLACE VIEW public.v_recruit_candidates_person_only WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id,rc.customer_id,
  coalesce(c.customer_name,p.display_name) AS customer_name,
  coalesce(c.gender,p.gender) AS gender,coalesce(c.birthday,p.birthday) AS birthday,
  coalesce(c.phone,p.phone) AS phone,coalesce(c.wx_account,p.wechat) AS wx_account,
  coalesce(c.occupation,p.occupation) AS occupation,c.annual_income,
  coalesce(c.education,p.education) AS education,c.mbti,
  coalesce(c.source,p.source) AS source,c.marital_status,c.hobbies,c.additional_info,
  rc.recommender_id,rc.stage,rc.stage_changed_at,rc.potential_score,
  rc.potential_reason,rc.motivation,rc.concerns,rc.work_experience,
  rc.family_situation,rc.personality_tags,rc.career_plan,rc.next_action_date,
  rc.next_action,rc.activity_history,rc.radar_image_file_id,rc.radar_image_name,
  rc.winner_report_file_id,rc.winner_report_name,rc.operator,rc.created_at,
  rc.updated_at,CASE WHEN rc.stage_changed_at IS NOT NULL
    THEN EXTRACT(DAY FROM now()-rc.stage_changed_at)::integer ELSE NULL::integer END AS idle_days,
  rc.profile,rc.person_id
FROM public.recruit_candidates rc
JOIN public.persons p ON p.id=rc.person_id AND p.deleted_at IS NULL
LEFT JOIN public.customers c ON c."Id"=rc.customer_id
WHERE rc.deleted_at IS NULL AND rc.customer_id IS NULL;

CREATE OR REPLACE VIEW public.v_recruit_candidates_person_only_trash WITH (security_invoker=true) AS
SELECT rc.id AS candidate_id,rc.customer_id,
  coalesce(c.customer_name,p.display_name) AS customer_name,
  coalesce(c.phone,p.phone) AS phone,coalesce(c.occupation,p.occupation) AS occupation,
  rc.stage,rc.operator,rc.created_at,rc.updated_at,
  rc.deleted_at AS candidate_deleted_at,c.deleted_at AS customer_deleted_at,rc.person_id
FROM public.recruit_candidates rc
JOIN public.persons p ON p.id=rc.person_id
LEFT JOIN public.customers c ON c."Id"=rc.customer_id
WHERE rc.deleted_at IS NOT NULL AND rc.customer_id IS NULL;
REVOKE ALL ON public.v_recruit_candidates_person_only,public.v_recruit_candidates_person_only_trash FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v_recruit_candidates_person_only,public.v_recruit_candidates_person_only_trash TO service_role;

CREATE TABLE public.person_identity_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid text NOT NULL CHECK (length(btrim(actor_uid)) BETWEEN 1 AND 200),
  idempotency_key uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('person','customer','recruit','speaker','capture')),
  payload jsonb NOT NULL,
  candidate_fingerprint text NOT NULL,
  preview jsonb NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','executed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
  executed_at timestamptz,
  UNIQUE(actor_uid,idempotency_key)
);
ALTER TABLE public.person_identity_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_identity_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY person_identity_commands_service_only ON public.person_identity_commands
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.person_identity_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.person_identity_commands TO service_role;

CREATE OR REPLACE FUNCTION public.person_directory_page_v1(
  p_page integer DEFAULT 1,p_page_size integer DEFAULT 50,p_keyword text DEFAULT '',
  p_sort_field text DEFAULT 'id',p_sort_dir text DEFAULT 'desc')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $directory$
DECLARE v_total bigint; v_pages integer; v_rows jsonb; v_order text;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_page IS NULL OR p_page<1 OR p_page>100000 OR p_page_size IS NULL
     OR p_page_size<1 OR p_page_size>50 OR length(coalesce(p_keyword,''))>40
     OR p_sort_field NOT IN ('id','display_name','updated_at')
     OR p_sort_dir NOT IN ('asc','desc') THEN RAISE EXCEPTION 'Invalid directory request'; END IF;
  SELECT count(*) INTO v_total FROM public.persons p WHERE p.deleted_at IS NULL
    AND (btrim(p_keyword)='' OR position(lower(btrim(p_keyword)) in lower(p.display_name))>0);
  v_pages:=greatest(1,ceil(v_total::numeric/p_page_size)::integer);
  v_order:=format('p.%I %s NULLS LAST, p.id %s',p_sort_field,upper(p_sort_dir),upper(p_sort_dir));
  EXECUTE format($sql$SELECT coalesce(jsonb_agg(to_jsonb(t)-'_ordinal' ORDER BY t._ordinal),'[]'::jsonb) FROM (
    SELECT row_number() OVER (ORDER BY %s) AS _ordinal,
      p.id,p.display_name,p.occupation,p.organization,p.updated_at,
      p.legacy_customer_id AS customer_id,
      (SELECT coalesce(jsonb_agg(pr.role ORDER BY pr.role),'[]'::jsonb)
         FROM public.person_roles pr WHERE pr.person_id=p.id) AS roles,
      (SELECT rc.id FROM public.recruit_candidates rc
         WHERE rc.person_id=p.id AND rc.deleted_at IS NULL ORDER BY rc.id LIMIT 1) AS recruit_id
    FROM public.persons p WHERE p.deleted_at IS NULL
      AND (btrim($1)='' OR position(lower(btrim($1)) in lower(p.display_name))>0)
    ORDER BY %s LIMIT $2 OFFSET $3) t$sql$,v_order,v_order)
    INTO v_rows USING p_keyword,p_page_size,(p_page-1)*p_page_size;
  RETURN jsonb_build_object('rows',v_rows,'page',p_page,'pageSize',p_page_size,
    'total',v_total,'totalPages',v_pages,'hasMore',p_page<v_pages,
    'sortField',p_sort_field,'sortDir',p_sort_dir);
END $directory$;
REVOKE ALL ON FUNCTION public.person_directory_page_v1(integer,integer,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.person_directory_page_v1(integer,integer,text,text,text) TO service_role;

-- The two command functions below are intentionally service-role only. The
-- logged-in Cloud Function supplies actor_uid; browser flags have no authority.
CREATE OR REPLACE FUNCTION public.person_identity_preview_v1(
  p_actor_uid text,p_idempotency_key uuid,p_kind text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $preview$
DECLARE v_id uuid; v_existing public.person_identity_commands%ROWTYPE;
  v_name text;v_name_key text;v_person_id bigint;v_person public.persons%ROWTYPE;
  v_fingerprint text;v_preview jsonb;v_customer_id bigint;v_recruit_id bigint;v_speaker_id bigint;
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
  SELECT "Id" INTO v_customer_id FROM public.customers WHERE customer_name=v_name AND deleted_at IS NULL;
  IF p_kind='customer' OR (p_kind='capture' AND coalesce((p_payload->>'customer')::boolean,false)) THEN
    IF v_person_id IS NOT NULL AND v_person.legacy_customer_id IS NOT NULL THEN
      v_customer_id:=v_person.legacy_customer_id;
      IF NOT EXISTS (SELECT 1 FROM public.customers
        WHERE "Id"=v_customer_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Customer is in recycle bin; restore it first'; END IF;
    ELSIF v_customer_id IS NOT NULL THEN
      RAISE EXCEPTION 'Customer name already exists; review customer ID manually';
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
END $preview$;
REVOKE ALL ON FUNCTION public.person_identity_preview_v1(text,uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.person_identity_preview_v1(text,uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.person_identity_execute_v1(p_actor_uid text,p_preview_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $execute$
DECLARE v_cmd public.person_identity_commands%ROWTYPE;v_person public.persons%ROWTYPE;
  v_name_key text;v_fingerprint text;v_customer_id bigint;v_recruit_id bigint;
  v_speaker_id bigint;v_interaction_id bigint;v_result jsonb;v_parent_id text;
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
  v_customer_id:=v_person.legacy_customer_id;
  IF v_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers
    WHERE "Id"=v_customer_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Customer is in recycle bin; restore it first'; END IF;
  IF v_cmd.kind='customer' OR
     (v_cmd.kind='capture' AND coalesce((v_cmd.payload->>'customer')::boolean,false)) THEN
    IF v_customer_id IS NULL THEN
      IF EXISTS(SELECT 1 FROM public.customers
        WHERE customer_name=v_person.display_name) THEN
        RAISE EXCEPTION 'Customer name already exists; review customer ID manually'; END IF;
      INSERT INTO public.customers(customer_name,phone,wx_account,gender,birthday,
        occupation,education,source)
      VALUES(v_person.display_name,v_person.phone,v_person.wechat,v_person.gender,
        v_person.birthday,v_person.occupation,v_person.education,'Person 角色转换')
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
      UPDATE public.persons SET legacy_customer_id=v_customer_id,updated_at=now()
        WHERE id=v_person.id;
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
        INSERT INTO public.activity_speakers(name,person_id,customer_id,source,
          last_contact_date,last_contact_note,next_contact_date)
          VALUES(v_person.display_name,v_person.id,v_customer_id,'快速记录',
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
  v_result:=jsonb_build_object('personId',v_person.id,'customerId',v_customer_id,
    'recruitId',v_recruit_id,'speakerId',v_speaker_id,'interactionId',v_interaction_id,
    'replayed',false);
  UPDATE public.person_identity_commands SET status='executed',result=v_result,
    executed_at=now() WHERE id=v_cmd.id;
  RETURN v_result;
END $execute$;
REVOKE ALL ON FUNCTION public.person_identity_execute_v1(text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.person_identity_execute_v1(text,uuid) TO service_role;
CREATE OR REPLACE VIEW public.v_action_center WITH (security_invoker=true) AS
 SELECT action_id,
    action_type,
    person_type,
    person_id,
    person_name,
    title,
    next_action,
    action_date,
    priority,
    source,
        CASE
            WHEN action_date IS NULL THEN 'unscheduled'::text
            WHEN action_date < CURRENT_DATE THEN 'overdue'::text
            WHEN action_date = CURRENT_DATE THEN 'today'::text
            WHEN action_date > CURRENT_DATE THEN 'upcoming'::text
            ELSE NULL::text
        END AS status,
    stage,
    days_until,
    last_followup_date
   FROM ( SELECT 'customer-'::text || c."Id" AS action_id,
            'customer'::text AS action_type,
            'customer'::text AS person_type,
            c."Id"::bigint AS person_id,
            c.customer_name AS person_name,
            '客户经营 · '::text || c.customer_name AS title,
            NULLIF(btrim(c.next_action), ''::text) AS next_action,
            c.next_action_date AS action_date,
            c.sales_priority::text AS priority,
            'customers'::text AS source,
            c.customer_stage::text AS stage,
            c.next_action_date - CURRENT_DATE AS days_until,
            ( SELECT max(f.followup_date) AS max
                   FROM public.followups f
                  WHERE f.customer_id = c."Id" AND f.deleted_at IS NULL) AS last_followup_date
           FROM public.customers c
          WHERE c.deleted_at IS NULL AND (NULLIF(btrim(c.next_action), ''::text) IS NOT NULL OR c.next_action_date IS NOT NULL)
        UNION ALL
         SELECT 'followup-'::text || lf."Id",
            'followup'::text AS text,
            'customer'::text AS text,
            lf.customer_id::bigint AS customer_id,
            lf.customer_name,
            '跟进回访 · '::text || lf.customer_name,
            COALESCE(NULLIF(btrim(lf.next_action), ''::text), NULLIF(btrim(lf.interaction_summary), ''::text), lf.next_followup_goal) AS "coalesce",
            COALESCE(lf.next_action_date, lf.next_followup_date) AS "coalesce",
            NULL::text AS text,
            'followups'::text AS text,
            c2.customer_stage::text AS customer_stage,
            COALESCE(lf.next_action_date, lf.next_followup_date) - CURRENT_DATE,
            lf.followup_date
           FROM ( SELECT DISTINCT ON (f.customer_id) f."Id",
                    f.customer_id,
                    f.customer_name,
                    f.followup_date,
                    f.next_action,
                    f.next_action_date,
                    f.next_followup_date,
                    f.next_followup_goal,
                    f.interaction_summary
                   FROM public.followups f
                  WHERE f.deleted_at IS NULL AND (f.next_action_date IS NOT NULL OR f.next_followup_date IS NOT NULL OR NULLIF(btrim(f.next_action), ''::text) IS NOT NULL)
                  ORDER BY f.customer_id, f.followup_date DESC NULLS LAST, f."Id" DESC) lf
             LEFT JOIN public.customers c2 ON c2."Id" = lf.customer_id AND c2.deleted_at IS NULL
        UNION ALL
         SELECT 'opportunity-'::text || o.id,
            'opportunity'::text AS text,
            'customer'::text AS text,
            o.customer_id::bigint AS customer_id,
            COALESCE(c3.customer_name, '客户#'::text || o.customer_id) AS "coalesce",
            (o.opportunity_type || '机会跟进 · '::text) || COALESCE(c3.customer_name, '客户#'::text || o.customer_id),
            COALESCE(NULLIF(btrim(o.next_action), ''::text), NULLIF(btrim(o.last_progress), ''::text)) AS "coalesce",
            o.next_action_date,
            NULL::text AS text,
            'opportunities'::text AS text,
            o.status,
            o.next_action_date - CURRENT_DATE,
            ( SELECT max(f.followup_date) AS max
                   FROM public.followups f
                  WHERE f.customer_id = o.customer_id AND f.deleted_at IS NULL) AS max
           FROM public.opportunities o
             LEFT JOIN public.customers c3 ON c3."Id" = o.customer_id AND c3.deleted_at IS NULL
          WHERE o.deleted_at IS NULL AND o.customer_id IS NOT NULL AND (o.status <> ALL (ARRAY['成交'::text, '关闭'::text]))
        UNION ALL
         SELECT 'recruit-'::text || rc.id,
            'recruit'::text AS text,
            'recruit'::text AS text,
            rc.id,
            c4.customer_name,
            ((('增员推进 · '::text || c4.customer_name) || '（'::text) || rc.stage) || '）'::text,
            NULLIF(btrim(rc.next_action), ''::text) AS "nullif",
            rc.next_action_date,
            NULL::text AS text,
            'recruit_candidates'::text AS text,
            rc.stage,
            rc.next_action_date - CURRENT_DATE,
            ( SELECT max(rf.followup_date) AS max
                   FROM public.recruit_followups rf
                  WHERE rf.candidate_id = rc.id AND rf.deleted_at IS NULL) AS max
           FROM public.recruit_candidates rc
             JOIN public.customers c4 ON c4."Id" = rc.customer_id AND c4.deleted_at IS NULL
          WHERE rc.deleted_at IS NULL AND rc.stage <> '流失'::text AND (NULLIF(btrim(rc.next_action), ''::text) IS NOT NULL OR rc.next_action_date IS NOT NULL)
        UNION ALL
         SELECT 'recruit_followup-'::text || lr.id,
            'recruit_followup'::text AS text,
            'recruit'::text AS text,
            lr.candidate_id,
            COALESCE(c5.customer_name, '候选人#'::text || lr.candidate_id) AS "coalesce",
            '增员跟进 · '::text || COALESCE(c5.customer_name, '候选人#'::text || lr.candidate_id),
            COALESCE(NULLIF(btrim(lr.next_action), ''::text), NULLIF(btrim(lr.interaction_summary), ''::text), NULLIF(btrim(lr.next_followup_goal), ''::text)) AS "coalesce",
            COALESCE(lr.next_action_date, lr.next_followup_date) AS "coalesce",
            NULL::text AS text,
            'recruit_followups'::text AS text,
            rc5.stage,
            COALESCE(lr.next_action_date, lr.next_followup_date) - CURRENT_DATE,
            lr.followup_date
           FROM ( SELECT DISTINCT ON (rf.candidate_id) rf.id,
                    rf.candidate_id,
                    rf.followup_date,
                    rf.next_action,
                    rf.next_action_date,
                    rf.next_followup_date,
                    rf.next_followup_goal,
                    rf.interaction_summary
                   FROM public.recruit_followups rf
                  WHERE rf.deleted_at IS NULL AND (rf.next_action_date IS NOT NULL OR rf.next_followup_date IS NOT NULL OR NULLIF(btrim(rf.next_action), ''::text) IS NOT NULL)
                  ORDER BY rf.candidate_id, rf.followup_date DESC, rf.id DESC) lr
             JOIN public.recruit_candidates rc5 ON rc5.id = lr.candidate_id AND rc5.deleted_at IS NULL
             LEFT JOIN public.customers c5 ON c5."Id" = rc5.customer_id AND c5.deleted_at IS NULL
        UNION ALL
         SELECT 'activity_task-'::text || t.id,
            'activity_task'::text AS text,
            'activity'::text AS text,
            t.activity_id,
            COALESCE(a.name, '活动#'::text || t.activity_id) AS "coalesce",
            (COALESCE(a.name, '活动#'::text || t.activity_id) || ' · '::text) || t.task_title,
            COALESCE(NULLIF(btrim(t.note), ''::text), t.task_title) AS "coalesce",
            t.due_date,
            t.priority,
            'activity_tasks'::text AS text,
            t.status,
            t.due_date - CURRENT_DATE,
            NULL::date AS date
           FROM public.activity_tasks t
             LEFT JOIN public.activities a ON a.id = t.activity_id AND a.deleted_at IS NULL
          WHERE (t.status = ANY (ARRAY['pending'::text, 'in_progress'::text])) AND a.deleted_at IS NULL) v;

CREATE OR REPLACE FUNCTION public.crm_delete_batch(p_kind text, p_action text, p_ids bigint[])
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_ids bigint[]; v_id bigint; v_parent bigint; v_locked_parents bigint[]; v_locked_people bigint[];
  v_root record; v_batch uuid; v_ts timestamptz; v_cands bigint[];
  v_table text; v_n bigint; v_restored integer := 0;
  v_counts jsonb := '{}'::jsonb; v_skipped jsonb := '[]'::jsonb;
  v_legacy jsonb := '[]'::jsonb;
BEGIN
  IF p_kind NOT IN ('customer','recruit') OR p_kind IS NULL
     OR p_action NOT IN ('remove','restore') OR p_action IS NULL THEN
    RAISE EXCEPTION 'Invalid delete-batch operation';
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_ids
    FROM (SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL AND x <> 0) s;
  IF coalesce(cardinality(v_ids),0) = 0 OR cardinality(v_ids) > 100
     OR (p_action = 'remove' AND cardinality(v_ids) <> 1) THEN
    RAISE EXCEPTION 'Expected 1..100 IDs (one ID for remove)';
  END IF;
  -- All operations lock customers before candidates, in ascending ID order.
  IF p_kind = 'customer' THEN
    v_locked_parents := v_ids;
  ELSE
    SELECT array_agg(DISTINCT customer_id ORDER BY customer_id) INTO v_locked_parents
      FROM public.recruit_candidates WHERE id = ANY(v_ids);
  END IF;
  PERFORM "Id" FROM public.customers WHERE "Id" = ANY(v_locked_parents) ORDER BY "Id" FOR UPDATE;
  IF p_kind = 'recruit' THEN
    SELECT array_agg(DISTINCT person_id ORDER BY person_id) INTO v_locked_people
      FROM public.recruit_candidates WHERE id = ANY(v_ids) AND customer_id IS NULL;
    PERFORM id FROM public.persons WHERE id = ANY(v_locked_people) ORDER BY id FOR UPDATE;
  END IF;
  IF p_kind = 'customer' THEN
    PERFORM id FROM public.recruit_candidates WHERE customer_id = ANY(v_ids) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM id FROM public.recruit_candidates WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;
  END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    IF p_kind = 'customer' THEN
      SELECT "Id"::bigint AS id, "Id"::bigint AS customer_id,
        deleted_at IS NOT NULL AS deleted, delete_batch_id INTO v_root
        FROM public.customers WHERE "Id" = v_id;
    ELSE
      SELECT id, customer_id, person_id, deleted_at IS NOT NULL AS deleted, delete_batch_id INTO v_root
        FROM public.recruit_candidates WHERE id = v_id;
    END IF;
    IF NOT FOUND THEN
      IF p_action = 'remove' THEN RETURN jsonb_build_object('ok',false,'error','not found or already deleted'); END IF;
      CONTINUE;
    END IF;
    IF p_kind = 'recruit' AND NOT (coalesce(v_root.customer_id = ANY(v_locked_parents),false)
      OR (v_root.customer_id IS NULL AND coalesce(v_root.person_id = ANY(v_locked_people),false))) THEN
      RAISE EXCEPTION 'Candidate parent changed; retry' USING ERRCODE = '40001';
    END IF;
    IF p_action = 'remove' AND v_root.deleted THEN
      RETURN jsonb_build_object('ok',false,'error','not found or already deleted');
    END IF;
    IF p_action = 'restore' AND NOT v_root.deleted THEN CONTINUE; END IF;
    IF p_kind = 'recruit' AND p_action = 'restore' THEN
      IF v_root.customer_id IS NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.persons WHERE id=v_root.person_id AND deleted_at IS NULL) THEN
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id',v_id,'reason','Person 仍在回收站或不存在'));
          CONTINUE;
        END IF;
      ELSIF NOT EXISTS (SELECT 1 FROM public.customers WHERE "Id" = v_root.customer_id AND deleted_at IS NULL) THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id',v_id,'reason','客户仍在回收站或不存在，请先恢复客户'));
        CONTINUE;
      END IF;
    END IF;
    v_batch := v_root.delete_batch_id;
    v_ts := clock_timestamp();
    IF p_action = 'remove' THEN
      v_batch := gen_random_uuid();
      IF p_kind = 'customer' THEN
        UPDATE public.customers SET deleted_at = v_ts AT TIME ZONE 'UTC', delete_batch_id = v_batch WHERE "Id" = v_id;
      ELSE
        UPDATE public.recruit_candidates SET deleted_at = v_ts, delete_batch_id = v_batch WHERE id = v_id;
      END IF;
    END IF;
    -- Legacy roots have no reliable membership evidence: restore only the root.
    IF v_batch IS NOT NULL THEN
      IF p_kind = 'customer' THEN
        FOREACH v_table IN ARRAY ARRAY['followups','gifts','photos','policy_review_reports','ocr_records','products'] LOOP
          IF p_action = 'remove' THEN
            EXECUTE format('UPDATE public.%I SET deleted_at=$1, delete_batch_id=$2 WHERE customer_id=$3 AND deleted_at IS NULL',v_table)
              USING v_ts,v_batch,v_id;
          ELSE
            EXECUTE format('UPDATE public.%I SET deleted_at=NULL, delete_batch_id=NULL WHERE customer_id=$1 AND delete_batch_id=$2 AND deleted_at IS NOT NULL',v_table)
              USING v_id,v_batch;
          END IF;
          GET DIAGNOSTICS v_n = ROW_COUNT;
          v_counts := jsonb_set(v_counts,ARRAY[v_table],to_jsonb(coalesce((v_counts->>v_table)::bigint,0)+v_n));
        END LOOP;
        IF p_action = 'remove' THEN
          WITH changed AS (UPDATE public.recruit_candidates SET deleted_at=v_ts, delete_batch_id=v_batch
            WHERE customer_id=v_id AND deleted_at IS NULL RETURNING id)
            SELECT coalesce(array_agg(id),'{}'::bigint[]) INTO v_cands FROM changed;
        ELSE
          SELECT coalesce(array_agg(id),'{}'::bigint[]) INTO v_cands FROM public.recruit_candidates
            WHERE customer_id=v_id AND deleted_at IS NOT NULL AND delete_batch_id=v_batch;
          UPDATE public.recruit_candidates SET deleted_at=NULL, delete_batch_id=NULL
            WHERE id=ANY(v_cands) AND customer_id=v_id AND delete_batch_id=v_batch AND deleted_at IS NOT NULL;
        END IF;
        v_counts := jsonb_set(v_counts,ARRAY['recruit_candidates'],
          to_jsonb(coalesce((v_counts->>'recruit_candidates')::bigint,0)+cardinality(v_cands)));
      ELSE
        v_cands := ARRAY[v_id];
      END IF;
      IF p_action = 'remove' THEN
        UPDATE public.recruit_followups SET deleted_at=v_ts, delete_batch_id=v_batch
          WHERE candidate_id=ANY(v_cands) AND deleted_at IS NULL;
      ELSE
        UPDATE public.recruit_followups SET deleted_at=NULL, delete_batch_id=NULL
          WHERE candidate_id=ANY(v_cands) AND delete_batch_id=v_batch AND deleted_at IS NOT NULL;
      END IF;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_counts := jsonb_set(v_counts,ARRAY['recruit_followups'],
        to_jsonb(coalesce((v_counts->>'recruit_followups')::bigint,0)+v_n));
    ELSE
      v_legacy := v_legacy || jsonb_build_array(v_id);
    END IF;
    IF p_action = 'restore' THEN
      IF p_kind = 'customer' THEN
        UPDATE public.customers SET deleted_at=NULL, delete_batch_id=NULL WHERE "Id"=v_id;
      ELSE
        UPDATE public.recruit_candidates SET deleted_at=NULL, delete_batch_id=NULL WHERE id=v_id;
      END IF;
      v_restored := v_restored + 1;
    END IF;
  END LOOP;
  IF p_action = 'remove' THEN
    RETURN jsonb_build_object('ok',true,'deleted_at',v_ts,'cascaded',v_counts);
  END IF;
  RETURN jsonb_build_object('ok',true,'restored',v_restored,'cascaded',v_counts,
    'skipped',v_skipped,'legacy_restored',v_legacy);
END;
$fn$;

-- Future edits through the legacy customer form update the explicitly linked
-- Person in the same transaction. Historical differences remain untouched.
CREATE FUNCTION public.customer_person_identity_bridge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $bridge$
BEGIN
  UPDATE public.persons p SET
    display_name=NEW.customer_name,
    name_key=lower(regexp_replace(btrim(regexp_replace(translate(NEW.customer_name,'　',' '),
      '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$','')),'[[:space:]]+',' ','g')),
    phone=NEW.phone,wechat=NEW.wx_account,gender=NEW.gender,
    birthday=NEW.birthday,occupation=NEW.occupation,education=NEW.education,
    updated_at=coalesce(NEW.updated_at,now())
  WHERE p.legacy_customer_id=NEW."Id" AND p.deleted_at IS NULL;
  RETURN NEW;
END $bridge$;
REVOKE ALL ON FUNCTION public.customer_person_identity_bridge() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER customer_person_identity_bridge_trigger
  AFTER UPDATE OF customer_name,phone,wx_account,gender,birthday,occupation,education
  ON public.customers FOR EACH ROW
  WHEN (OLD.customer_name IS DISTINCT FROM NEW.customer_name OR
    OLD.phone IS DISTINCT FROM NEW.phone OR OLD.wx_account IS DISTINCT FROM NEW.wx_account OR
    OLD.gender IS DISTINCT FROM NEW.gender OR OLD.birthday IS DISTINCT FROM NEW.birthday OR
    OLD.occupation IS DISTINCT FROM NEW.occupation OR OLD.education IS DISTINCT FROM NEW.education)
  EXECUTE FUNCTION public.customer_person_identity_bridge();
COMMIT;
