-- PMC-14 盘点 Q9：回填前置断言 + 精确映射（只读；ID 数字可入证据，无 PII）
-- 断言：7 行软删 customer 各自唯一命中有效 Person；无同活动同 Person 重复对
WITH pending AS (
  SELECT ap.id, ap.activity_id, ap.person_id
  FROM public.activity_participants ap
  WHERE ap.deleted_at IS NOT NULL AND ap.person_type = 'customer'
    AND ap.person_id IS NOT NULL AND ap.canonical_person_id IS NULL
),
resolved AS (
  SELECT p.id AS ap_id, p.activity_id, p.person_id AS legacy_customer_id,
    (SELECT x.id FROM public.persons x
      WHERE x.legacy_customer_id = p.person_id AND x.deleted_at IS NULL) AS person_id,
    (SELECT count(*)::int FROM public.persons x
      WHERE x.legacy_customer_id = p.person_id AND x.deleted_at IS NULL) AS hits
  FROM pending p
)
SELECT ap_id, activity_id, legacy_customer_id, person_id, hits
FROM resolved
ORDER BY ap_id;
