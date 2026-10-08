-- PMC-04 conflict-check-detail.sql
-- 第二轮深查：persons 无 legacy_customer_id 的角色与引用；同名不同人的 phone/wechat 哈希比对。
-- 脱敏：phone/wechat/birthday/gender/occupation 用 md5 哈希；不输出真实值。
-- 经 tools/pg-readonly.cjs --file --snapshot 执行。

WITH
-- 1. persons 无 legacy_customer_id 的详细情况（角色/引用）
no_legacy_persons AS (
  SELECT
    p.id::text AS person_id,
    (p.deleted_at IS NOT NULL) AS softdeleted,
    p.source AS person_source,
    p.created_at,
    EXISTS(SELECT 1 FROM public.person_roles pr WHERE pr.person_id = p.id) AS has_role,
    (SELECT string_agg(DISTINCT pr.role, ',' ORDER BY pr.role)
       FROM public.person_roles pr WHERE pr.person_id = p.id) AS role_types,
    EXISTS(SELECT 1 FROM public.recruit_candidates rc WHERE rc.person_id = p.id) AS in_recruit,
    (SELECT count(*)::int FROM public.recruit_candidates rc WHERE rc.person_id = p.id) AS recruit_count,
    EXISTS(SELECT 1 FROM public.activity_speakers s WHERE s.person_id = p.id) AS in_speaker,
    (SELECT count(*)::int FROM public.activity_speakers s WHERE s.person_id = p.id) AS speaker_count,
    EXISTS(SELECT 1 FROM public.activity_participants ap WHERE ap.person_id = p.id OR ap.canonical_person_id = p.id) AS in_participant,
    (SELECT count(*)::int FROM public.activity_participants ap WHERE ap.person_id = p.id OR ap.canonical_person_id = p.id) AS participant_count,
    EXISTS(SELECT 1 FROM public.interactions i WHERE i.person_id = p.id) AS in_interaction,
    (SELECT count(*)::int FROM public.interactions i WHERE i.person_id = p.id) AS interaction_count,
    EXISTS(SELECT 1 FROM public.opportunities o WHERE o.person_id = p.id) AS in_opportunity,
    (SELECT count(*)::int FROM public.opportunities o WHERE o.person_id = p.id) AS opportunity_count,
    EXISTS(SELECT 1 FROM public.relationships r WHERE r.from_person_id = p.id OR r.to_person_id = p.id OR r.introduced_by_person_id = p.id) AS in_relationship,
    (SELECT count(*)::int FROM public.relationships r WHERE r.from_person_id = p.id OR r.to_person_id = p.id OR r.introduced_by_person_id = p.id) AS relationship_count
  FROM public.persons p
  WHERE p.legacy_customer_id IS NULL
),
-- 2. customers 无 Person 的 3 个详细情况
no_person_customers AS (
  SELECT
    c."Id"::text AS customer_id,
    (c.deleted_at IS NOT NULL) AS softdeleted,
    c.source AS customer_source,
    c.created_at,
    EXISTS(SELECT 1 FROM public.recruit_candidates rc WHERE rc.customer_id = c."Id") AS referenced_by_recruit,
    (SELECT count(*)::int FROM public.recruit_candidates rc WHERE rc.customer_id = c."Id") AS recruit_ref_count,
    EXISTS(SELECT 1 FROM public.activity_speakers s WHERE s.customer_id = c."Id") AS referenced_by_speaker,
    (SELECT count(*)::int FROM public.activity_speakers s WHERE s.customer_id = c."Id") AS speaker_ref_count,
    EXISTS(SELECT 1 FROM public.opportunities o WHERE o.customer_id = c."Id") AS in_opportunity,
    (SELECT count(*)::int FROM public.opportunities o WHERE o.customer_id = c."Id") AS opportunity_count
  FROM public.customers c
  LEFT JOIN public.persons p ON p.legacy_customer_id = c."Id"
  WHERE p.id IS NULL
),
-- 3. 同名不同人的 phone/wechat/birthday 哈希比对（判断是否可能是同一人）
same_name_groups AS (
  SELECT name_key, md5(name_key) AS name_key_hash
  FROM public.persons
  WHERE name_key IS NOT NULL AND name_key <> ''
  GROUP BY name_key
  HAVING count(*) > 1
),
same_name_persons AS (
  SELECT
    md5(p.name_key) AS name_key_hash,
    p.id::text AS person_id,
    p.legacy_customer_id::text AS legacy_customer_id,
    (p.deleted_at IS NOT NULL) AS softdeleted,
    md5(COALESCE(p.phone,'')) AS phone_hash,
    md5(COALESCE(p.wechat,'')) AS wechat_hash,
    md5(COALESCE(p.birthday::text,'')) AS birthday_hash,
    md5(COALESCE(p.gender,'')) AS gender_hash,
    md5(COALESCE(p.occupation,'')) AS occupation_hash,
    md5(COALESCE(p.organization,'')) AS organization_hash,
    md5(COALESCE(p.education,'')) AS education_hash
  FROM public.persons p
  JOIN same_name_groups sng ON sng.name_key = p.name_key
  WHERE p.deleted_at IS NULL
),
-- 4. 同名组内 phone/wechat 相同的（可能需合并确认；但不自动合并）
same_name_same_contact AS (
  SELECT
    name_key_hash,
    count(*)::int AS person_count,
    count(DISTINCT phone_hash)::int AS distinct_phones,
    count(DISTINCT wechat_hash)::int AS distinct_wechats,
    bool_or(phone_hash = md5('')) AS all_phones_empty,
    bool_or(wechat_hash = md5('')) AS all_wechats_empty,
    bool_or(phone_hash <> md5('') AND phone_hash IS NOT NULL) AS any_phone_present,
    bool_or(wechat_hash <> md5('') AND wechat_hash IS NOT NULL) AS any_wechat_present
  FROM same_name_persons
  GROUP BY name_key_hash
),
-- 5. 同名组内 phone/wechat 完全相同（非空）的组
merge_candidates AS (
  SELECT name_key_hash,
    count(*)::int AS person_count,
    count(DISTINCT phone_hash)::int AS distinct_phones_nonempty,
    count(DISTINCT wechat_hash)::int AS distinct_wechats_nonempty
  FROM same_name_persons
  WHERE phone_hash <> md5('') OR wechat_hash <> md5('')
  GROUP BY name_key_hash
  HAVING (count(DISTINCT phone_hash) = 1 AND bool_or(phone_hash <> md5('')))
      OR (count(DISTINCT wechat_hash) = 1 AND bool_or(wechat_hash <> md5('')))
)
SELECT jsonb_build_object(
  'observedAt', now(),
  'no_legacy_persons', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY person_id) FROM no_legacy_persons t), '[]'::jsonb),
  'no_legacy_persons_count', (SELECT count(*)::int FROM no_legacy_persons),
  'no_person_customers', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY customer_id) FROM no_person_customers t), '[]'::jsonb),
  'no_person_customers_count', (SELECT count(*)::int FROM no_person_customers),
  'same_name_persons', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY name_key_hash, person_id) FROM same_name_persons t), '[]'::jsonb),
  'same_name_group_count', (SELECT count(DISTINCT name_key_hash) FROM same_name_persons),
  'same_name_contact_analysis', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY name_key_hash) FROM same_name_same_contact t), '[]'::jsonb),
  'merge_candidates', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY name_key_hash) FROM merge_candidates t), '[]'::jsonb),
  'merge_candidate_count', (SELECT count(*)::int FROM merge_candidates)
) AS snapshot;
