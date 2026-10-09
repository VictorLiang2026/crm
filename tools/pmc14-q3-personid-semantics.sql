-- PMC-14 盘点 Q3：activity_participants.person_id 实际语义交叉验证（只读，无 PII）
-- 对每个 person_id 非空行，分别尝试按 persons.id / customers."Id" / activity_speakers.id / recruit_candidates.id 命中，
-- 并用登记快照名（person_name）与各域登记名比对，判断历史 person_id 实际保存的是哪一类 ID。
WITH j AS (
  SELECT ap.id AS ap_id, ap.person_name, ap.person_type, ap.canonical_person_id,
         p.id  AS hit_person, c."Id" AS hit_customer, s.id AS hit_speaker, rc.id AS hit_candidate,
         (ap.person_name = p.display_name)   AS name_eq_person,
         (ap.person_name = c.customer_name)  AS name_eq_customer,
         (ap.person_name = s.name)           AS name_eq_speaker
  FROM public.activity_participants ap
  LEFT JOIN public.persons p  ON p.id  = ap.person_id
  LEFT JOIN public.customers c ON c."Id" = ap.person_id
  LEFT JOIN public.activity_speakers s ON s.id = ap.person_id
  LEFT JOIN public.recruit_candidates rc ON rc.id = ap.person_id
  WHERE ap.person_id IS NOT NULL
)
SELECT
  COUNT(*)::int                                                              AS with_person_id,
  COUNT(*) FILTER (WHERE hit_person IS NOT NULL)::int                        AS hits_persons,
  COUNT(*) FILTER (WHERE hit_customer IS NOT NULL)::int                      AS hits_customers,
  COUNT(*) FILTER (WHERE hit_speaker IS NOT NULL)::int                       AS hits_speakers,
  COUNT(*) FILTER (WHERE hit_candidate IS NOT NULL)::int                     AS hits_candidates,
  COUNT(*) FILTER (WHERE hit_person IS NOT NULL AND hit_customer IS NOT NULL)::int AS ambiguous_id_both,
  COUNT(*) FILTER (WHERE name_eq_person AND NOT COALESCE(name_eq_customer, false))::int AS name_confirms_person,
  COUNT(*) FILTER (WHERE name_eq_customer AND NOT COALESCE(name_eq_person, false))::int AS name_confirms_customer,
  COUNT(*) FILTER (WHERE name_eq_person AND name_eq_customer)::int           AS name_eq_both,
  COUNT(*) FILTER (WHERE name_eq_speaker)::int                               AS name_eq_speaker,
  COUNT(*) FILTER (WHERE (hit_person IS NOT NULL OR hit_customer IS NOT NULL OR hit_speaker IS NOT NULL OR hit_candidate IS NOT NULL)
                   AND NOT COALESCE(name_eq_person, false)
                   AND NOT COALESCE(name_eq_customer, false)
                   AND NOT COALESCE(name_eq_speaker, false))::int            AS hit_but_name_mismatch,
  COUNT(*) FILTER (WHERE canonical_person_id IS NULL)::int                    AS canonical_null,
  COUNT(*) FILTER (WHERE canonical_person_id = hit_person)::int               AS canonical_eq_hit_person,
  COUNT(*) FILTER (WHERE canonical_person_id IS NOT NULL AND canonical_person_id <> hit_person)::int AS canonical_diff_from_hit
FROM j;
