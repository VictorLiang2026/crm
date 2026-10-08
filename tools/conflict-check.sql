-- PMC-04 conflict-check.sql
-- 只读冲突检测：找出客户/候选人/嘉宾/参与者与 Person 的缺失、一对多、多对一、孤立、软删除、字段冲突。
-- 脱敏：只输出对象 ID + 差异标记 + 哈希；不输出真实姓名/电话/微信/生日等 PII 值。
-- 经 tools/pg-readonly.cjs --file --snapshot 执行（单条 WITH 语句，拒绝 DDL/DML/多语句）。

WITH
-- 1. 缺失
missing_person_for_customer AS (
  SELECT c."Id"::text AS customer_id,
         (c.deleted_at IS NOT NULL) AS customer_softdeleted,
         'customer_without_person'::text AS gap_type
  FROM public.customers c
  LEFT JOIN public.persons p ON p.legacy_customer_id = c."Id"
  WHERE p.id IS NULL
),
missing_legacy_for_person AS (
  SELECT p.id::text AS person_id,
         (p.deleted_at IS NOT NULL) AS person_softdeleted,
         'person_without_legacy'::text AS gap_type
  FROM public.persons p
  WHERE p.legacy_customer_id IS NULL
),
-- 2. 一对多：同一 legacy_customer_id 对应多个 persons（UNIQUE 约束应保证为 0，复核）
duplicate_legacy AS (
  SELECT legacy_customer_id::text AS legacy_customer_id,
         count(*)::int AS person_count,
         array_agg(id::text ORDER BY id) AS person_ids
  FROM public.persons
  WHERE legacy_customer_id IS NOT NULL
  GROUP BY legacy_customer_id
  HAVING count(*) > 1
),
-- 3. 多对一：多个 customers 指向同一 person（legacy_customer_id UNIQUE 应保证为 0，复核）
multi_customer_per_person AS (
  SELECT p.id::text AS person_id,
         count(c."Id")::int AS customer_count,
         array_agg(c."Id"::text ORDER BY c."Id") AS customer_ids
  FROM public.persons p
  JOIN public.customers c ON c."Id" = p.legacy_customer_id
  GROUP BY p.id
  HAVING count(c."Id") > 1
),
-- 4. 软删除不一致
softdelete_mismatch AS (
  SELECT 'person_deleted_customer_alive'::text AS mismatch_type,
         p.id::text AS person_id,
         p.legacy_customer_id::text AS legacy_customer_id
  FROM public.persons p
  JOIN public.customers c ON c."Id" = p.legacy_customer_id
  WHERE p.deleted_at IS NOT NULL AND c.deleted_at IS NULL
  UNION ALL
  SELECT 'customer_deleted_person_alive'::text,
         p.id::text,
         p.legacy_customer_id::text
  FROM public.persons p
  JOIN public.customers c ON c."Id" = p.legacy_customer_id
  WHERE p.deleted_at IS NULL AND c.deleted_at IS NOT NULL
),
-- 5. 字段冲突（persons vs customers 同名副本字段差异；只输出差异标记，不输出真实值）
field_conflicts AS (
  SELECT
    p.id::text AS person_id,
    p.legacy_customer_id::text AS customer_id,
    (p.display_name IS DISTINCT FROM c.customer_name) AS name_diff,
    (p.phone IS DISTINCT FROM c.phone
     AND COALESCE(p.phone,'') <> ''
     AND COALESCE(c.phone,'') <> '') AS phone_both_present_diff,
    (COALESCE(p.phone,'') <> '' AND COALESCE(c.phone,'') = '') AS phone_only_person,
    (COALESCE(p.phone,'') = '' AND COALESCE(c.phone,'') <> '') AS phone_only_customer,
    (p.birthday IS DISTINCT FROM c.birthday
     AND p.birthday IS NOT NULL
     AND c.birthday IS NOT NULL) AS birthday_both_present_diff,
    (p.birthday IS NOT NULL AND c.birthday IS NULL) AS birthday_only_person,
    (p.birthday IS NULL AND c.birthday IS NOT NULL) AS birthday_only_customer,
    (p.gender IS DISTINCT FROM c.gender
     AND COALESCE(p.gender,'') <> ''
     AND COALESCE(c.gender,'') <> '') AS gender_both_present_diff,
    (COALESCE(p.gender,'') <> '' AND COALESCE(c.gender,'') = '') AS gender_only_person,
    (COALESCE(p.gender,'') = '' AND COALESCE(c.gender,'') <> '') AS gender_only_customer,
    (p.occupation IS DISTINCT FROM c.occupation
     AND COALESCE(p.occupation,'') <> ''
     AND COALESCE(c.occupation,'') <> '') AS occupation_both_present_diff,
    (COALESCE(p.occupation,'') <> '' AND COALESCE(c.occupation,'') = '') AS occupation_only_person,
    (COALESCE(p.occupation,'') = '' AND COALESCE(c.occupation,'') <> '') AS occupation_only_customer,
    (p.education IS DISTINCT FROM c.education
     AND COALESCE(p.education,'') <> ''
     AND COALESCE(c.education,'') <> '') AS education_both_present_diff,
    (COALESCE(p.education,'') <> '' AND COALESCE(c.education,'') = '') AS education_only_person,
    (COALESCE(p.education,'') = '' AND COALESCE(c.education,'') <> '') AS education_only_customer,
    (p.wechat IS DISTINCT FROM c.wx_account
     AND COALESCE(p.wechat,'') <> ''
     AND COALESCE(c.wx_account,'') <> '') AS wechat_both_present_diff,
    (COALESCE(p.wechat,'') <> '' AND COALESCE(c.wx_account,'') = '') AS wechat_only_person,
    (COALESCE(p.wechat,'') = '' AND COALESCE(c.wx_account,'') <> '') AS wechat_only_customer
  FROM public.persons p
  JOIN public.customers c ON c."Id" = p.legacy_customer_id
  WHERE p.deleted_at IS NULL AND c.deleted_at IS NULL
),
field_conflict_summary AS (
  SELECT
    count(*)::int AS total_compared,
    count(*) FILTER (WHERE name_diff)::int AS name_diff,
    count(*) FILTER (WHERE phone_both_present_diff)::int AS phone_both_present_diff,
    count(*) FILTER (WHERE phone_only_person)::int AS phone_only_person,
    count(*) FILTER (WHERE phone_only_customer)::int AS phone_only_customer,
    count(*) FILTER (WHERE birthday_both_present_diff)::int AS birthday_both_present_diff,
    count(*) FILTER (WHERE birthday_only_person)::int AS birthday_only_person,
    count(*) FILTER (WHERE birthday_only_customer)::int AS birthday_only_customer,
    count(*) FILTER (WHERE gender_both_present_diff)::int AS gender_both_present_diff,
    count(*) FILTER (WHERE gender_only_person)::int AS gender_only_person,
    count(*) FILTER (WHERE gender_only_customer)::int AS gender_only_customer,
    count(*) FILTER (WHERE occupation_both_present_diff)::int AS occupation_both_present_diff,
    count(*) FILTER (WHERE occupation_only_person)::int AS occupation_only_person,
    count(*) FILTER (WHERE occupation_only_customer)::int AS occupation_only_customer,
    count(*) FILTER (WHERE education_both_present_diff)::int AS education_both_present_diff,
    count(*) FILTER (WHERE education_only_person)::int AS education_only_person,
    count(*) FILTER (WHERE education_only_customer)::int AS education_only_customer,
    count(*) FILTER (WHERE wechat_both_present_diff)::int AS wechat_both_present_diff,
    count(*) FILTER (WHERE wechat_only_person)::int AS wechat_only_person,
    count(*) FILTER (WHERE wechat_only_customer)::int AS wechat_only_customer
  FROM field_conflicts
),
-- 只输出有差异的记录（脱敏：ID + 差异标记，无真实值）
field_conflict_rows AS (
  SELECT person_id, customer_id, name_diff,
         phone_both_present_diff, phone_only_person, phone_only_customer,
         birthday_both_present_diff, birthday_only_person, birthday_only_customer,
         gender_both_present_diff, gender_only_person, gender_only_customer,
         occupation_both_present_diff, occupation_only_person, occupation_only_customer,
         education_both_present_diff, education_only_person, education_only_customer,
         wechat_both_present_diff, wechat_only_person, wechat_only_customer
  FROM field_conflicts
  WHERE name_diff OR phone_both_present_diff OR phone_only_person OR phone_only_customer
     OR birthday_both_present_diff OR birthday_only_person OR birthday_only_customer
     OR gender_both_present_diff OR gender_only_person OR gender_only_customer
     OR occupation_both_present_diff OR occupation_only_person OR occupation_only_customer
     OR education_both_present_diff OR education_only_person OR education_only_customer
     OR wechat_both_present_diff OR wechat_only_person OR wechat_only_customer
),
-- 6. 同名不同人（persons 中 name_key 相同但 id 不同；name_key 用 md5 哈希脱敏）
same_name_different_person AS (
  SELECT md5(name_key) AS name_key_hash,
         count(*)::int AS person_count,
         array_agg(id::text ORDER BY id) AS person_ids,
         array_agg((legacy_customer_id IS NOT NULL)::text ORDER BY id) AS has_legacy_arr,
         array_agg((deleted_at IS NOT NULL)::text ORDER BY id) AS is_deleted_arr
  FROM public.persons
  WHERE name_key IS NOT NULL AND name_key <> ''
  GROUP BY name_key
  HAVING count(*) > 1
),
-- 7. 嘉宾孤立（activity_speakers.customer_id 无 FK；person_id FK 复核）
speaker_customer_orphan AS (
  SELECT s.id::text AS speaker_id,
         s.customer_id::text AS customer_id,
         'speaker_customer_no_fk_match'::text AS orphan_type
  FROM public.activity_speakers s
  WHERE s.customer_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c."Id" = s.customer_id)
),
speaker_person_orphan AS (
  SELECT s.id::text AS speaker_id,
         s.person_id::text AS person_id,
         'speaker_person_no_match'::text AS orphan_type
  FROM public.activity_speakers s
  WHERE s.person_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = s.person_id)
),
speaker_recruit_orphan AS (
  SELECT s.id::text AS speaker_id,
         s.recruit_candidate_id::text AS recruit_candidate_id,
         'speaker_recruit_no_match'::text AS orphan_type
  FROM public.activity_speakers s
  WHERE s.recruit_candidate_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.recruit_candidates r WHERE r.id = s.recruit_candidate_id)
),
-- 8. 参与者孤立（person_id 无 FK；canonical_person_id FK 复核）
participant_person_orphan AS (
  SELECT ap.id::text AS participant_id,
         ap.person_id::text AS person_id,
         'participant_person_no_match'::text AS orphan_type
  FROM public.activity_participants ap
  WHERE ap.person_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = ap.person_id)
),
participant_canonical_orphan AS (
  SELECT ap.id::text AS participant_id,
         ap.canonical_person_id::text AS canonical_person_id,
         'participant_canonical_no_match'::text AS orphan_type
  FROM public.activity_participants ap
  WHERE ap.canonical_person_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = ap.canonical_person_id)
),
-- 9. 招募候选人孤立（customer_id FK 复核；person_id FK 复核）
recruit_customer_orphan AS (
  SELECT rc.id::text AS candidate_id,
         rc.customer_id::text AS customer_id,
         'recruit_customer_no_match'::text AS orphan_type
  FROM public.recruit_candidates rc
  WHERE rc.customer_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c."Id" = rc.customer_id)
),
recruit_person_orphan AS (
  SELECT rc.id::text AS candidate_id,
         rc.person_id::text AS person_id,
         'recruit_person_no_match'::text AS orphan_type
  FROM public.recruit_candidates rc
  WHERE rc.person_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = rc.person_id)
),
-- 10. 机会孤立（customer_id / person_id FK 复核）
opp_customer_orphan AS (
  SELECT o.id::text AS opportunity_id,
         o.customer_id::text AS customer_id,
         'opportunity_customer_no_match'::text AS orphan_type
  FROM public.opportunities o
  WHERE o.customer_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c."Id" = o.customer_id)
),
opp_person_orphan AS (
  SELECT o.id::text AS opportunity_id,
         o.person_id::text AS person_id,
         'opportunity_person_no_match'::text AS orphan_type
  FROM public.opportunities o
  WHERE o.person_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = o.person_id)
),
-- 11. 互动孤立（person_id FK 复核）
interaction_person_orphan AS (
  SELECT i.id::text AS interaction_id,
         i.person_id::text AS person_id,
         'interaction_person_no_match'::text AS orphan_type
  FROM public.interactions i
  WHERE i.person_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = i.person_id)
)
SELECT jsonb_build_object(
  'observedAt', now(),
  'schema', 'public',
  'missing', jsonb_build_object(
    'customers_without_person', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY customer_id) FROM missing_person_for_customer t), '[]'::jsonb),
    'persons_without_legacy', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY person_id) FROM missing_legacy_for_person t), '[]'::jsonb),
    'customers_without_person_count', (SELECT count(*)::int FROM missing_person_for_customer),
    'persons_without_legacy_count', (SELECT count(*)::int FROM missing_legacy_for_person)
  ),
  'one_to_many', jsonb_build_object(
    'duplicate_legacy_customer_ids', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY legacy_customer_id) FROM duplicate_legacy t), '[]'::jsonb),
    'duplicate_legacy_count', (SELECT count(*)::int FROM duplicate_legacy)
  ),
  'many_to_one', jsonb_build_object(
    'multi_customer_per_person', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY person_id) FROM multi_customer_per_person t), '[]'::jsonb),
    'multi_customer_count', (SELECT count(*)::int FROM multi_customer_per_person)
  ),
  'softdelete_mismatch', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY mismatch_type, person_id) FROM softdelete_mismatch t), '[]'::jsonb),
    'count', (SELECT count(*)::int FROM softdelete_mismatch)
  ),
  'field_conflicts', jsonb_build_object(
    'summary', (SELECT row_to_json(t) FROM field_conflict_summary t),
    'conflict_rows', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY person_id) FROM field_conflict_rows t), '[]'::jsonb),
    'conflict_row_count', (SELECT count(*)::int FROM field_conflict_rows)
  ),
  'same_name_different_person', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY name_key_hash) FROM same_name_different_person t), '[]'::jsonb),
    'group_count', (SELECT count(*)::int FROM same_name_different_person),
    'total_persons_in_groups', (SELECT COALESCE(sum(person_count),0)::int FROM same_name_different_person)
  ),
  'orphans', jsonb_build_object(
    'speaker_customer_orphan', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY speaker_id) FROM speaker_customer_orphan t), '[]'::jsonb),
    'speaker_person_orphan', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY speaker_id) FROM speaker_person_orphan t), '[]'::jsonb),
    'speaker_recruit_orphan', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY speaker_id) FROM speaker_recruit_orphan t), '[]'::jsonb),
    'participant_person_orphan', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY participant_id) FROM participant_person_orphan t), '[]'::jsonb),
    'participant_canonical_orphan', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY participant_id) FROM participant_canonical_orphan t), '[]'::jsonb),
    'recruit_customer_orphan', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY candidate_id) FROM recruit_customer_orphan t), '[]'::jsonb),
    'recruit_person_orphan', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY candidate_id) FROM recruit_person_orphan t), '[]'::jsonb),
    'opp_customer_orphan', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY opportunity_id) FROM opp_customer_orphan t), '[]'::jsonb),
    'opp_person_orphan', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY opportunity_id) FROM opp_person_orphan t), '[]'::jsonb),
    'interaction_person_orphan', COALESCE((SELECT jsonb_agg(row_to_json(t) ORDER BY interaction_id) FROM interaction_person_orphan t), '[]'::jsonb),
    'speaker_customer_orphan_count', (SELECT count(*)::int FROM speaker_customer_orphan),
    'speaker_person_orphan_count', (SELECT count(*)::int FROM speaker_person_orphan),
    'speaker_recruit_orphan_count', (SELECT count(*)::int FROM speaker_recruit_orphan),
    'participant_person_orphan_count', (SELECT count(*)::int FROM participant_person_orphan),
    'participant_canonical_orphan_count', (SELECT count(*)::int FROM participant_canonical_orphan),
    'recruit_customer_orphan_count', (SELECT count(*)::int FROM recruit_customer_orphan),
    'recruit_person_orphan_count', (SELECT count(*)::int FROM recruit_person_orphan),
    'opp_customer_orphan_count', (SELECT count(*)::int FROM opp_customer_orphan),
    'opp_person_orphan_count', (SELECT count(*)::int FROM opp_person_orphan),
    'interaction_person_orphan_count', (SELECT count(*)::int FROM interaction_person_orphan)
  )
) AS snapshot;
