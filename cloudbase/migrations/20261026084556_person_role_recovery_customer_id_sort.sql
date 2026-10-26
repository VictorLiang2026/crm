-- Customer ID sorting and role recovery discovery for Person 360.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.person_customer_worklist_v1(jsonb)'::regprocedure))
       IS DISTINCT FROM '0e1219b77f56a132070892a85a0a19b4'
     OR md5(pg_get_functiondef('public.person_identity_execute_v1(text,uuid)'::regprocedure))
       IS DISTINCT FROM '6bfc7224f04de2e4295ea095d5cc23e2'
     OR to_regprocedure('public.person_role_recovery_v1(text,bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Role recovery baseline changed; inspect before applying';
  END IF;
END
$guard$;

CREATE FUNCTION public.person_role_recovery_v1(p_actor_uid text,p_person_id bigint,p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_name text;
  v_customer jsonb;
  v_recruit jsonb;
  v_parent_customer jsonb;
BEGIN
  IF current_user <> 'service_role' OR nullif(btrim(p_actor_uid),'') IS NULL
     OR p_person_id IS NULL OR p_kind NOT IN ('customer','recruit') THEN
    RAISE EXCEPTION 'Invalid role recovery request';
  END IF;
  SELECT display_name INTO v_name FROM public.persons
    WHERE id=p_person_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Person not found'; END IF;

  IF p_kind='customer' THEN
    SELECT jsonb_build_object('id',c."Id",'deleted',true) INTO v_customer
    FROM public.customers c
    WHERE c.person_id=p_person_id AND c.deleted_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.customers active
        WHERE active.person_id=p_person_id AND active.deleted_at IS NULL)
    ORDER BY c.deleted_at DESC,c."Id" DESC LIMIT 1;
    RETURN jsonb_build_object('personId',p_person_id,'displayName',v_name,'customer',v_customer);
  END IF;

  SELECT jsonb_build_object('id',r.id,'customerId',r.customer_id,
    'personOnly',r.customer_id IS NULL,'deleted',true)
    INTO v_recruit
  FROM public.recruit_candidates r
  WHERE r.person_id=p_person_id AND r.deleted_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.recruit_candidates active
      WHERE active.person_id=p_person_id AND active.deleted_at IS NULL)
  ORDER BY r.deleted_at DESC,r.id DESC LIMIT 1;

  IF v_recruit IS NOT NULL AND (v_recruit->>'customerId') IS NOT NULL THEN
    SELECT jsonb_build_object('id',c."Id",'deleted',c.deleted_at IS NOT NULL)
      INTO v_parent_customer
    FROM public.customers c WHERE c."Id"=(v_recruit->>'customerId')::bigint;
  END IF;
  RETURN jsonb_build_object('personId',p_person_id,'displayName',v_name,
    'recruit',v_recruit,'parentCustomer',v_parent_customer);
END
$function$;
REVOKE ALL ON FUNCTION public.person_role_recovery_v1(text,bigint,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.person_role_recovery_v1(text,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.person_customer_worklist_v1(p_criteria jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_page integer := (p_criteria->>'page')::integer;
  v_size integer := (p_criteria->>'pageSize')::integer;
  v_keyword text := p_criteria->>'keyword';
  v_field text := p_criteria->>'sortField';
  v_dir text := p_criteria->>'sortDir';
  v_status text := p_criteria->>'status';
  v_priorities jsonb := p_criteria->'customerPriorities';
  v_today date := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  v_result jsonb;
  v_order text;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF jsonb_typeof(p_criteria) IS DISTINCT FROM 'object'
    OR v_page IS NULL OR v_page NOT BETWEEN 1 AND 1000
    OR v_size IS NULL OR v_size NOT BETWEEN 1 AND 50
    OR v_keyword IS NULL OR length(v_keyword)>40
    OR v_field IS NULL OR v_field NOT IN ('id','display_name','updated_at','sales_priority',
      'recruitment_priority','referral_priority','latest_followup_date','next_followup_date','wb_status','customer_id')
    OR v_dir IS NULL OR v_dir NOT IN ('asc','desc')
    OR v_status IS NULL OR v_status NOT IN ('all','overdue','today','month','stale','normal','unknown','unlinked')
    OR jsonb_typeof(v_priorities) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid customer worklist criteria'; END IF;
  IF jsonb_array_length(v_priorities)>5 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_priorities) AS x(value)
    WHERE value IS NULL OR value NOT IN ('A','B','C','D','E')
  ) THEN RAISE EXCEPTION 'Invalid customer priorities'; END IF;
  -- Identifiers and direction are allowlisted above; all filter values are bound.
  v_order := format('%I %s NULLS LAST, id ASC',
    CASE WHEN v_field='wb_status' THEN 'wb_sort' ELSE v_field END, upper(v_dir));
  EXECUTE format($query$
    WITH base AS (
      SELECT p.id,p.display_name,p.updated_at,p.customer_stage,p.sales_priority,
        p.referral_priority,rc.recruitment_priority,c."Id" AS customer_id,
        rc.id AS recruit_id,rc.stage AS recruit_stage,
        CASE WHEN rc.id IS NOT NULL THEN 'active'
          WHEN EXISTS(SELECT 1 FROM public.recruit_candidates old_rc
            WHERE old_rc.deleted_at IS NOT NULL AND
              (old_rc.person_id=p.id OR (old_rc.person_id IS NULL AND old_rc.customer_id=c."Id")))
            THEN 'historical' ELSE 'none' END AS recruit_status,
        (SELECT coalesce(jsonb_agg(r.role ORDER BY r.role),'[]'::jsonb)
          FROM public.person_roles r WHERE r.person_id=p.id) AS roles,
        f.followup_date AS latest_followup_date,f.next_followup_date,
        coalesce(f.followup_date,p.first_contact_date,(c.created_at AT TIME ZONE 'UTC')::date) AS last_contact_date
      FROM public.persons p
      LEFT JOIN LATERAL (
        SELECT c0."Id",c0.created_at FROM public.customers c0
        WHERE c0.person_id=p.id AND c0.deleted_at IS NULL ORDER BY c0."Id" DESC LIMIT 1
      ) c ON true
      LEFT JOIN LATERAL (
        SELECT rc0.id,rc0.stage,rc0.recruitment_priority FROM public.recruit_candidates rc0
        WHERE rc0.deleted_at IS NULL AND
          (rc0.person_id=p.id OR (rc0.person_id IS NULL AND rc0.customer_id=c."Id"))
        ORDER BY rc0.id DESC LIMIT 1
      ) rc ON true
      LEFT JOIN LATERAL (
        SELECT x.followup_date,x.next_followup_date FROM public.followups x
        WHERE x.customer_id=c."Id" AND x.deleted_at IS NULL
        ORDER BY x.followup_date DESC NULLS LAST,x."Id" DESC LIMIT 1
      ) f ON true
      WHERE p.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM public.person_roles r WHERE r.person_id=p.id AND r.role='customer')
        AND ($1='' OR strpos(lower(p.display_name),lower($1))>0)
        AND (jsonb_array_length($2)=0 OR $2 ? p.sales_priority::text)
    ), scored AS (
      SELECT base.*,
        CASE WHEN customer_id IS NULL THEN 'unlinked'
          WHEN next_followup_date<$3 THEN 'overdue'
          WHEN next_followup_date=$3 THEN 'today'
          WHEN next_followup_date<=$3+30 THEN 'month'
          WHEN $3-last_contact_date>=30 THEN 'stale'
          WHEN last_contact_date IS NULL AND next_followup_date IS NULL THEN 'unknown'
          ELSE 'normal' END AS wb_status,
        CASE WHEN customer_id IS NULL THEN 700000
          WHEN next_followup_date<$3 THEN 100000-($3-next_followup_date)
          WHEN next_followup_date=$3 THEN 200000
          WHEN next_followup_date<=$3+30 THEN 300000+(next_followup_date-$3)
          WHEN $3-last_contact_date>=30 THEN 400000-($3-last_contact_date)
          WHEN last_contact_date IS NULL AND next_followup_date IS NULL THEN 600000
          WHEN next_followup_date IS NOT NULL THEN 500000+(next_followup_date-$3)
          ELSE 500000 END AS wb_sort
      FROM base
    ), filtered AS (
      SELECT * FROM scored WHERE $4='all' OR wb_status=$4
    ), ordered AS (
      SELECT *,row_number() OVER(ORDER BY %s) AS ordinal FROM filtered
    )
    SELECT jsonb_build_object(
      'rows',coalesce((SELECT jsonb_agg(to_jsonb(x)-'ordinal'-'wb_sort' ORDER BY ordinal)
        FROM(SELECT * FROM ordered ORDER BY ordinal LIMIT $5 OFFSET $6)x),'[]'::jsonb),
      'total',(SELECT count(*) FROM filtered))
  $query$,v_order)
  INTO v_result USING btrim(v_keyword),v_priorities,v_today,v_status,v_size,(v_page-1)*v_size;
  RETURN v_result || jsonb_build_object('page',v_page,'pageSize',v_size,
    'totalPages',greatest(1,ceil((v_result->>'total')::numeric/v_size)::integer),
    'hasMore',v_page*v_size<(v_result->>'total')::bigint,
    'sortField',v_field,'sortDir',v_dir,'asOfDate',v_today,'timezone','Asia/Shanghai');
END
$function$;


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
  IF v_customer_id IS NULL AND v_cmd.kind<>'recruit' AND EXISTS (SELECT 1 FROM public.customers
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
  IF v_cmd.kind IN ('capture_v2_new','capture_v2_existing') THEN
    IF v_cmd.kind='capture_v2_new' AND v_cmd.payload ? 'person_id' THEN
      RAISE EXCEPTION 'New Person capture cannot select an existing Person'; END IF;
    IF v_cmd.kind='capture_v2_existing' AND NOT (v_cmd.payload ? 'person_id') THEN
      RAISE EXCEPTION 'Selected Person is required'; END IF;
    v_capture_result:=public.quick_capture_v2_commit(v_person.id,
      v_cmd.payload->>'display_name',p_actor_uid,v_cmd.payload->'interaction',
      v_cmd.payload->'facts',v_cmd.payload->'signals');
    v_interaction_id:=(v_capture_result->>'interactionId')::bigint;
  END IF;
  v_result:=jsonb_build_object('personId',v_person.id,'customerId',v_customer_id,
    'recruitId',v_recruit_id,'speakerId',v_speaker_id,'interactionId',v_interaction_id,
    'replayed',false);
  IF v_cmd.kind IN ('capture_v2_new','capture_v2_existing') THEN
    v_result:=v_result||jsonb_build_object('contextItemCount',
      (v_capture_result->>'contextItemCount')::integer);
  END IF;
  UPDATE public.person_identity_commands SET status='executed',result=v_result,
    executed_at=now() WHERE id=v_cmd.id;
  RETURN v_result;
END
$function$;


NOTIFY pgrst,'reload schema';
COMMIT;

