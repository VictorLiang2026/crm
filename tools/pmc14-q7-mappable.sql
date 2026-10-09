-- PMC-14 盘点 Q7：缺 canonical 参与行的可确认性（只读，无 PII，仅计数与布尔）
-- 规则与 migration 20260929084000 一致，外加经 speakers.person_id 直连（PMC-13 后嘉宾权威关联）
WITH pending AS (
  SELECT ap.id, ap.person_type, ap.person_id, (ap.deleted_at IS NOT NULL) AS is_deleted
  FROM public.activity_participants ap
  WHERE ap.person_id IS NOT NULL AND ap.canonical_person_id IS NULL
),
bridge AS (
  SELECT p.id, p.person_type, p.is_deleted,
    (SELECT count(*)::int FROM public.persons x
      WHERE x.legacy_customer_id = p.person_id AND x.deleted_at IS NULL) AS cust_bridge_hits,
    (SELECT count(*)::int FROM public.persons x
      WHERE x.legacy_customer_id = p.person_id) AS cust_bridge_hits_all,
    (SELECT count(*)::int FROM public.persons x
      JOIN public.activity_speakers s ON s.person_id = x.id
      WHERE s.id = p.person_id AND x.deleted_at IS NULL) AS speaker_person_hits,
    EXISTS (SELECT 1 FROM public.persons x WHERE x.id = p.person_id) AS hits_person_direct
  FROM pending p
)
SELECT
  count(*)::int AS pending_rows,
  count(*) FILTER (WHERE is_deleted)::int AS pending_deleted,
  count(*) FILTER (WHERE NOT is_deleted)::int AS pending_alive,
  count(*) FILTER (WHERE person_type = 'customer' AND cust_bridge_hits = 1)::int AS cust_bridge_unique,
  count(*) FILTER (WHERE person_type = 'customer' AND cust_bridge_hits > 1)::int AS cust_bridge_multi,
  count(*) FILTER (WHERE person_type = 'customer' AND cust_bridge_hits = 0)::int AS cust_bridge_zero,
  count(*) FILTER (WHERE person_type = 'speaker' AND speaker_person_hits = 1)::int AS speaker_person_unique,
  count(*) FILTER (WHERE person_type = 'speaker' AND speaker_person_hits = 0)::int AS speaker_unmapped,
  count(*) FILTER (WHERE person_type NOT IN ('customer','speaker') AND hits_person_direct)::int AS other_direct_hit,
  count(*) FILTER (WHERE is_deleted AND person_type = 'customer' AND cust_bridge_hits = 1)::int AS softdel_cust_bridge_unique,
  count(*) FILTER (WHERE cust_bridge_hits_all > 0 AND cust_bridge_hits = 0)::int AS bridge_only_softdel_person
FROM bridge;
