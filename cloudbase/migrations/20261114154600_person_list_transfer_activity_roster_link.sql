BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.crm_person_list_transfer_create_v1(text,jsonb,jsonb)'::regprocedure))<>'504d7336b39c42fa4b93c97b27d0dec5' THEN
  RAISE EXCEPTION 'Person list transfer function baseline changed';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.crm_person_list_transfer_create_v1(
  p_actor_uid text,
  p_existing jsonb,
  p_new_person jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $create$
DECLARE
  v_item jsonb;
  v_person public.persons%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_id bigint;
  v_display_name text;
  v_new_display_name text;
  v_name_key text;
  v_existing_key text;
  v_existing_qualifier text;
  v_new_qualifier text;
  v_roster public.activity_roster_people%ROWTYPE;
  v_roster_id bigint;
  v_roster_version bigint;
BEGIN
  IF current_user <> 'service_role' OR nullif(btrim(p_actor_uid), '') IS NULL OR length(p_actor_uid) > 128 THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF jsonb_typeof(p_existing) IS DISTINCT FROM 'array' OR
     jsonb_typeof(p_new_person) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid Person list transfer payload';
  END IF;
  IF jsonb_array_length(p_existing) > 10 THEN RAISE EXCEPTION 'Too many existing Person renames'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_new_person) AS k(name)
             WHERE name NOT IN ('display_name','name_key','phone','wechat','gender','birthday','occupation',
               'organization','education','source','hobbies','customer_stage','sales_priority',
               'referral_priority','marital_status','first_contact_date','notes','activityRosterLink')) THEN
    RAISE EXCEPTION 'Person field is not writable';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_existing) AS e(value)
             WHERE jsonb_typeof(value) IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'Invalid existing Person rename';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_existing) AS e(value)
             WHERE (SELECT count(*) FROM jsonb_object_keys(value)) <> 3 OR
               EXISTS (SELECT 1 FROM jsonb_object_keys(value) AS k(name)
                       WHERE name NOT IN ('personId','expectedUpdatedAt','displayName')) OR
               coalesce(value->>'personId','') !~ '^[1-9][0-9]*$' OR
               coalesce(value->>'expectedUpdatedAt','') !~ '^\d{4}-\d{2}-\d{2}T') THEN
    RAISE EXCEPTION 'Invalid existing Person rename';
  END IF;
  IF (SELECT count(DISTINCT value->>'personId') FROM jsonb_array_elements(p_existing) AS e(value)) <>
     jsonb_array_length(p_existing) THEN
    RAISE EXCEPTION 'Duplicate existing Person rename';
  END IF;

  v_new_display_name := nullif(btrim(p_new_person->>'display_name'), '');
  IF v_new_display_name IS NULL OR length(v_new_display_name) > 160 OR
     (v_new_display_name !~ '(（[^（）]+）|\([^()]+\))[[:space:]]*$' AND NOT (p_new_person ? 'activityRosterLink')) THEN
    RAISE EXCEPTION 'New Person name must include a qualifier';
  END IF;
  v_name_key := lower(regexp_replace(btrim(regexp_replace(translate(v_new_display_name,'　',' '),
    '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$','')),
    '[[:space:]]+',' ','g'));
  IF v_name_key = '' OR v_name_key IS DISTINCT FROM p_new_person->>'name_key' THEN
    RAISE EXCEPTION 'Invalid Person name key';
  END IF;
  IF p_new_person ? 'activityRosterLink' THEN
    IF jsonb_typeof(p_new_person->'activityRosterLink') IS DISTINCT FROM 'object' OR
       (SELECT count(*) FROM jsonb_object_keys(p_new_person->'activityRosterLink')) <> 3 OR
       EXISTS(SELECT 1 FROM jsonb_object_keys(p_new_person->'activityRosterLink') AS k(name)
         WHERE name NOT IN ('id','version','displayName')) THEN
      RAISE EXCEPTION 'Invalid activity roster link';
    END IF;
    v_roster_id := nullif(p_new_person->'activityRosterLink'->>'id','')::bigint;
    v_roster_version := nullif(p_new_person->'activityRosterLink'->>'version','')::bigint;
    PERFORM pg_advisory_xact_lock(hashtextextended('activity-roster:'||v_name_key,0));
    SELECT * INTO v_roster FROM public.activity_roster_people WHERE id=v_roster_id FOR UPDATE;
    IF NOT FOUND OR v_roster.person_id IS NOT NULL OR v_roster.version IS DISTINCT FROM v_roster_version OR
       v_roster.name_key IS DISTINCT FROM v_name_key OR
       v_roster.display_name IS DISTINCT FROM p_new_person->'activityRosterLink'->>'displayName' THEN
      RAISE EXCEPTION 'Activity roster candidate changed; preview again';
    END IF;
  END IF;
  v_new_qualifier := lower(coalesce(
    (regexp_match(v_new_display_name,'（([^（）]+)）[[:space:]]*$'))[1],
    (regexp_match(v_new_display_name,'\(([^()]+)\)[[:space:]]*$'))[1]));
  IF (v_new_qualifier IS NULL AND (NOT (p_new_person ? 'activityRosterLink') OR jsonb_array_length(p_existing)>0)) OR
     (v_new_qualifier IS NOT NULL AND EXISTS (
    SELECT 1 FROM (
      SELECT lower(coalesce((regexp_match(value->>'displayName','（([^（）]+)）[[:space:]]*$'))[1],
        (regexp_match(value->>'displayName','\(([^()]+)\)[[:space:]]*$'))[1])) AS qualifier
      FROM jsonb_array_elements(p_existing) AS e(value)
      UNION ALL SELECT v_new_qualifier
    ) qualifiers GROUP BY qualifier HAVING count(*) > 1
  )) THEN RAISE EXCEPTION 'Person qualifiers must be distinct'; END IF;
  IF p_new_person ? 'gender' AND nullif(p_new_person->>'gender','') NOT IN ('男','女','未知')
     AND p_new_person->'gender' <> 'null'::jsonb THEN RAISE EXCEPTION 'Invalid gender'; END IF;
  IF p_new_person ? 'customer_stage' AND nullif(p_new_person->>'customer_stage','') NOT IN
     ('新认识','关系维护','需求挖掘','方案沟通','成交推进','转介绍经营')
     AND p_new_person->'customer_stage' <> 'null'::jsonb THEN RAISE EXCEPTION 'Invalid customer_stage'; END IF;
  IF p_new_person ? 'sales_priority' AND nullif(p_new_person->>'sales_priority','') NOT IN ('A','B','C','D','E')
     AND p_new_person->'sales_priority' <> 'null'::jsonb THEN RAISE EXCEPTION 'Invalid sales_priority'; END IF;
  IF p_new_person ? 'referral_priority' AND nullif(p_new_person->>'referral_priority','') NOT IN ('A','B','C','D','E')
     AND p_new_person->'referral_priority' <> 'null'::jsonb THEN RAISE EXCEPTION 'Invalid referral_priority'; END IF;

  -- Lock and verify every existing row before making either the renames or the insert.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_existing) ORDER BY (value->>'personId')::bigint LOOP
    SELECT * INTO v_person FROM public.persons
     WHERE id = (v_item->>'personId')::bigint AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_person.updated_at IS DISTINCT FROM (v_item->>'expectedUpdatedAt')::timestamptz THEN
      RETURN jsonb_build_object('ok',false,'conflict',true,'code','PREVIEW_STALE');
    END IF;
    v_display_name := nullif(btrim(v_item->>'displayName'), '');
    IF v_display_name IS NULL OR length(v_display_name) > 160 OR
       v_display_name !~ '(（[^（）]+）|\([^()]+\))[[:space:]]*$' THEN
      RAISE EXCEPTION 'Existing Person name must include a qualifier';
    END IF;
    v_existing_key := lower(regexp_replace(btrim(regexp_replace(translate(v_display_name,'　',' '),
      '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$','')),
      '[[:space:]]+',' ','g'));
    IF v_existing_key = '' OR v_existing_key IS DISTINCT FROM v_person.name_key THEN
      RAISE EXCEPTION 'Existing Person name base cannot change';
    END IF;
    v_existing_qualifier := lower((regexp_match(v_display_name,'(?:（([^（）]+)）|\(([^()]+)\))[[:space:]]*$'))[1]);
    IF v_existing_qualifier IS NULL THEN
      v_existing_qualifier := lower((regexp_match(v_display_name,'\(([^()]+)\)[[:space:]]*$'))[1]);
    END IF;
    IF v_existing_qualifier IS NOT NULL AND v_existing_qualifier = v_new_qualifier THEN
      RAISE EXCEPTION 'Person qualifiers must be distinct';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.persons p
     WHERE p.deleted_at IS NULL AND p.name_key = v_name_key
       AND p.display_name !~ '(（[^（）]+）|\([^()]+\))[[:space:]]*$'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_existing) AS e(value)
                       WHERE (e.value->>'personId')::bigint = p.id)
  ) THEN RAISE EXCEPTION 'Existing unqualified Person requires a qualifier'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.persons p
     WHERE p.deleted_at IS NULL AND p.name_key = v_name_key
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_existing) AS e(value)
                       WHERE (e.value->>'personId')::bigint = p.id)
       AND lower(coalesce((regexp_match(p.display_name,'（([^（）]+)）[[:space:]]*$'))[1],
             (regexp_match(p.display_name,'\(([^()]+)\)[[:space:]]*$'))[1])) = v_new_qualifier
  ) THEN RAISE EXCEPTION 'Person qualifier already exists'; END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT value->>'displayName' AS display_name FROM jsonb_array_elements(p_existing) AS e(value)
      UNION ALL SELECT v_new_display_name
    ) names GROUP BY display_name HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Person names must be distinct'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.persons p
     WHERE p.deleted_at IS NULL
       AND p.display_name IN (
         SELECT value->>'displayName' FROM jsonb_array_elements(p_existing) AS e(value)
         UNION SELECT v_new_display_name
       )
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_existing) AS e(value)
                       WHERE (e.value->>'personId')::bigint = p.id)
  ) THEN RAISE EXCEPTION 'Person name already exists'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_existing) ORDER BY (value->>'personId')::bigint LOOP
    UPDATE public.persons SET
      display_name = btrim(v_item->>'displayName'),
      name_key = lower(regexp_replace(btrim(regexp_replace(translate(btrim(v_item->>'displayName'),'　',' '),
        '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$','')),
        '[[:space:]]+',' ','g')),
      updated_at = v_now
    WHERE id = (v_item->>'personId')::bigint;
  END LOOP;

  INSERT INTO public.persons (
    display_name,name_key,phone,wechat,gender,birthday,occupation,organization,education,source,hobbies,
    customer_stage,sales_priority,referral_priority,marital_status,first_contact_date,notes
  ) VALUES (
    v_new_display_name,v_name_key,nullif(p_new_person->>'phone',''),nullif(p_new_person->>'wechat',''),
    nullif(p_new_person->>'gender',''),nullif(p_new_person->>'birthday','')::date,
    nullif(p_new_person->>'occupation',''),nullif(p_new_person->>'organization',''),
    nullif(p_new_person->>'education',''),nullif(p_new_person->>'source',''),nullif(p_new_person->>'hobbies',''),
    nullif(p_new_person->>'customer_stage','')::public."客户经营阶段",
    nullif(p_new_person->>'sales_priority','')::public."优先级",
    nullif(p_new_person->>'referral_priority','')::public."优先级",
    nullif(p_new_person->>'marital_status',''),nullif(p_new_person->>'first_contact_date','')::date,
    nullif(p_new_person->>'notes','')
  ) RETURNING id INTO v_id;
  IF v_roster_id IS NOT NULL THEN
    UPDATE public.persons SET
      phone=coalesce(nullif(phone,''),nullif(v_roster.phone,'')),
      wechat=coalesce(nullif(wechat,''),nullif(v_roster.wechat,'')),
      organization=coalesce(nullif(organization,''),nullif(v_roster.organization,'')),
      education=coalesce(nullif(education,''),nullif(v_roster.school,'')),
      updated_at=clock_timestamp() WHERE id=v_id;
    UPDATE public.activity_roster_people SET person_id=v_id,display_name=v_new_display_name,
      name_key=v_name_key,version=version+1,updated_at=clock_timestamp() WHERE id=v_roster_id;
    UPDATE public.activity_participants SET canonical_person_id=v_id,person_name=v_new_display_name,
      updated_at=clock_timestamp() WHERE roster_id=v_roster_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'personId',v_id,'displayName',v_new_display_name,'updatedAt',v_now,
    'activityRosterLinked',v_roster_id IS NOT NULL,'activityRosterId',v_roster_id);
END
$create$;
REVOKE ALL ON FUNCTION public.crm_person_list_transfer_create_v1(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_person_list_transfer_create_v1(text,jsonb,jsonb) TO service_role;
COMMIT;
