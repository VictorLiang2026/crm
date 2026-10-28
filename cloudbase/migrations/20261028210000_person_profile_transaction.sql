-- Save the existing Person, Customer, and Recruit edit form atomically.
-- All SQL objects and writes are explicitly scoped to public.
CREATE OR REPLACE FUNCTION public.crm_person_profile_save_v1(
  p_actor_uid text,
  p_person_id bigint,
  p_person_expected_updated_at timestamptz,
  p_person_fields jsonb,
  p_customer_id bigint,
  p_customer_expected_updated_at timestamptz,
  p_customer_fields jsonb,
  p_recruit_id bigint,
  p_recruit_expected_updated_at timestamptz,
  p_recruit_fields jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $save$
DECLARE
  v_person public.persons%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_recruit public.recruit_candidates%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_name text;
BEGIN
  IF current_user <> 'service_role' OR nullif(btrim(p_actor_uid), '') IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_person_id IS NULL OR p_person_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Person ID and expected version are required';
  END IF;
  IF jsonb_typeof(coalesce(p_person_fields, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(coalesce(p_customer_fields, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(coalesce(p_recruit_fields, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Profile fields must be JSON objects';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(p_person_fields, '{}'::jsonb)) AS fields(k)
             WHERE k NOT IN ('display_name','phone','wechat','gender','birthday','occupation',
               'organization','education','source','hobbies','customer_stage','sales_priority',
               'referral_priority','marital_status','first_contact_date','notes')) THEN
    RAISE EXCEPTION 'Person field is not writable';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(p_customer_fields, '{}'::jsonb)) AS fields(k)
             WHERE k NOT IN ('tags','additional_info','annual_income','household_income',
               'properties_info','mbti','profile')) THEN
    RAISE EXCEPTION 'Customer field is not writable';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(p_recruit_fields, '{}'::jsonb)) AS fields(k)
             WHERE k <> 'recruitment_priority') THEN
    RAISE EXCEPTION 'Recruit field is not writable';
  END IF;

  IF p_person_fields ? 'display_name' THEN
    v_name := nullif(btrim(p_person_fields->>'display_name'), '');
    IF v_name IS NULL OR length(v_name) > 160 THEN RAISE EXCEPTION 'Invalid display_name'; END IF;
  END IF;
  IF p_person_fields ? 'gender' AND p_person_fields->>'gender' NOT IN ('男','女','未知')
     AND p_person_fields->'gender' <> 'null'::jsonb THEN RAISE EXCEPTION 'Invalid gender'; END IF;
  IF p_person_fields ? 'customer_stage' AND p_person_fields->>'customer_stage' NOT IN
     ('新认识','关系维护','需求挖掘','方案沟通','成交推进','转介绍经营')
     AND p_person_fields->'customer_stage' <> 'null'::jsonb THEN RAISE EXCEPTION 'Invalid customer_stage'; END IF;
  IF p_person_fields ? 'sales_priority' AND p_person_fields->>'sales_priority' NOT IN ('A','B','C','D','E')
     AND p_person_fields->'sales_priority' <> 'null'::jsonb THEN RAISE EXCEPTION 'Invalid sales_priority'; END IF;
  IF p_person_fields ? 'referral_priority' AND p_person_fields->>'referral_priority' NOT IN ('A','B','C','D','E')
     AND p_person_fields->'referral_priority' <> 'null'::jsonb THEN RAISE EXCEPTION 'Invalid referral_priority'; END IF;
  IF p_recruit_fields ? 'recruitment_priority'
     AND p_recruit_fields->>'recruitment_priority' NOT IN ('A','B','C','D','E')
     AND p_recruit_fields->'recruitment_priority' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Invalid recruitment_priority';
  END IF;
  IF p_customer_fields ? 'annual_income' AND p_customer_fields->'annual_income' <> 'null'::jsonb
     AND ((p_customer_fields->>'annual_income') !~ '^[0-9]+$'
       OR (p_customer_fields->>'annual_income')::numeric > 2147483647) THEN
    RAISE EXCEPTION 'Invalid annual_income';
  END IF;
  IF p_customer_fields ? 'profile' AND jsonb_typeof(p_customer_fields->'profile') <> 'object'
     AND p_customer_fields->'profile' <> 'null'::jsonb THEN RAISE EXCEPTION 'Invalid customer profile'; END IF;

  -- Lock and validate every changed row before updating any of them.
  SELECT * INTO v_person FROM public.persons
   WHERE id = p_person_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_person.updated_at <> p_person_expected_updated_at THEN
    RETURN jsonb_build_object('ok',false,'conflict',true,'code','PROFILE_CONFLICT','scope','person');
  END IF;
  IF coalesce(p_customer_fields, '{}'::jsonb) <> '{}'::jsonb THEN
    IF p_customer_id IS NULL OR p_customer_expected_updated_at IS NULL THEN
      RAISE EXCEPTION 'Customer ID and expected version are required';
    END IF;
    SELECT * INTO v_customer FROM public.customers
     WHERE "Id" = p_customer_id AND person_id = p_person_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_customer.updated_at <> p_customer_expected_updated_at THEN
      RETURN jsonb_build_object('ok',false,'conflict',true,'code','PROFILE_CONFLICT','scope','customer');
    END IF;
  END IF;
  IF coalesce(p_recruit_fields, '{}'::jsonb) <> '{}'::jsonb THEN
    IF p_recruit_id IS NULL OR p_recruit_expected_updated_at IS NULL THEN
      RAISE EXCEPTION 'Recruit ID and expected version are required';
    END IF;
    SELECT * INTO v_recruit FROM public.recruit_candidates
     WHERE id = p_recruit_id AND person_id = p_person_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_recruit.updated_at <> p_recruit_expected_updated_at THEN
      RETURN jsonb_build_object('ok',false,'conflict',true,'code','PROFILE_CONFLICT','scope','recruit');
    END IF;
  END IF;
  IF coalesce(p_person_fields, '{}'::jsonb) = '{}'::jsonb
     AND coalesce(p_customer_fields, '{}'::jsonb) = '{}'::jsonb
     AND coalesce(p_recruit_fields, '{}'::jsonb) = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok',true,'updated',false);
  END IF;

  IF coalesce(p_person_fields, '{}'::jsonb) <> '{}'::jsonb THEN
    UPDATE public.persons SET
      display_name = CASE WHEN p_person_fields ? 'display_name' THEN v_name ELSE display_name END,
      name_key = CASE WHEN p_person_fields ? 'display_name' THEN
        lower(regexp_replace(btrim(regexp_replace(translate(v_name,'　',' '),
          '([[:space:]]*(（[^（）]+）|[(][^()]+[)]))+[[:space:]]*$','')),
          '[[:space:]]+',' ','g')) ELSE name_key END,
      phone = CASE WHEN p_person_fields ? 'phone' THEN nullif(p_person_fields->>'phone','') ELSE phone END,
      wechat = CASE WHEN p_person_fields ? 'wechat' THEN nullif(p_person_fields->>'wechat','') ELSE wechat END,
      gender = CASE WHEN p_person_fields ? 'gender' THEN p_person_fields->>'gender' ELSE gender END,
      birthday = CASE WHEN p_person_fields ? 'birthday' THEN nullif(p_person_fields->>'birthday','')::date ELSE birthday END,
      occupation = CASE WHEN p_person_fields ? 'occupation' THEN nullif(p_person_fields->>'occupation','') ELSE occupation END,
      organization = CASE WHEN p_person_fields ? 'organization' THEN nullif(p_person_fields->>'organization','') ELSE organization END,
      education = CASE WHEN p_person_fields ? 'education' THEN nullif(p_person_fields->>'education','') ELSE education END,
      source = CASE WHEN p_person_fields ? 'source' THEN nullif(p_person_fields->>'source','') ELSE source END,
      hobbies = CASE WHEN p_person_fields ? 'hobbies' THEN nullif(p_person_fields->>'hobbies','') ELSE hobbies END,
      customer_stage = CASE WHEN p_person_fields ? 'customer_stage' THEN (p_person_fields->>'customer_stage')::public."客户经营阶段" ELSE customer_stage END,
      sales_priority = CASE WHEN p_person_fields ? 'sales_priority' THEN (p_person_fields->>'sales_priority')::public."优先级" ELSE sales_priority END,
      referral_priority = CASE WHEN p_person_fields ? 'referral_priority' THEN (p_person_fields->>'referral_priority')::public."优先级" ELSE referral_priority END,
      marital_status = CASE WHEN p_person_fields ? 'marital_status' THEN nullif(p_person_fields->>'marital_status','') ELSE marital_status END,
      first_contact_date = CASE WHEN p_person_fields ? 'first_contact_date' THEN nullif(p_person_fields->>'first_contact_date','')::date ELSE first_contact_date END,
      notes = CASE WHEN p_person_fields ? 'notes' THEN nullif(p_person_fields->>'notes','') ELSE notes END,
      updated_at = v_now
    WHERE id = p_person_id;
  END IF;
  IF coalesce(p_customer_fields, '{}'::jsonb) <> '{}'::jsonb THEN
    UPDATE public.customers SET
      tags = CASE WHEN p_customer_fields ? 'tags' THEN p_customer_fields->>'tags' ELSE tags END,
      additional_info = CASE WHEN p_customer_fields ? 'additional_info' THEN p_customer_fields->>'additional_info' ELSE additional_info END,
      annual_income = CASE WHEN p_customer_fields ? 'annual_income' THEN nullif(p_customer_fields->>'annual_income','')::integer ELSE annual_income END,
      household_income = CASE WHEN p_customer_fields ? 'household_income' THEN p_customer_fields->>'household_income' ELSE household_income END,
      properties_info = CASE WHEN p_customer_fields ? 'properties_info' THEN p_customer_fields->>'properties_info' ELSE properties_info END,
      mbti = CASE WHEN p_customer_fields ? 'mbti' THEN p_customer_fields->>'mbti' ELSE mbti END,
      profile = CASE WHEN p_customer_fields ? 'profile' THEN p_customer_fields->'profile' ELSE profile END,
      updated_at = v_now
    WHERE "Id" = p_customer_id;
  END IF;
  IF coalesce(p_recruit_fields, '{}'::jsonb) <> '{}'::jsonb THEN
    UPDATE public.recruit_candidates SET
      recruitment_priority = (p_recruit_fields->>'recruitment_priority')::public."优先级",
      updated_at = v_now
    WHERE id = p_recruit_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'updated',true,'personId',p_person_id,
    'customerId',CASE WHEN coalesce(p_customer_fields, '{}'::jsonb) <> '{}'::jsonb THEN p_customer_id END,
    'recruitId',CASE WHEN coalesce(p_recruit_fields, '{}'::jsonb) <> '{}'::jsonb THEN p_recruit_id END,
    'updatedAt',v_now);
END
$save$;

REVOKE ALL ON FUNCTION public.crm_person_profile_save_v1(text,bigint,timestamptz,jsonb,bigint,timestamptz,jsonb,bigint,timestamptz,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_person_profile_save_v1(text,bigint,timestamptz,jsonb,bigint,timestamptz,jsonb,bigint,timestamptz,jsonb)
  TO service_role;
COMMENT ON FUNCTION public.crm_person_profile_save_v1(text,bigint,timestamptz,jsonb,bigint,timestamptz,jsonb,bigint,timestamptz,jsonb)
  IS 'Atomically saves the existing Person edit form across public.persons, public.customers, and public.recruit_candidates with per-row optimistic locking.';
