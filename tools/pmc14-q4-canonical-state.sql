-- PMC-14 盘点 Q4：activity_participants 身份关联状态总览（只读，无 PII）
SELECT
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS alive,
  COUNT(*) FILTER (WHERE deleted_at IS NULL AND person_id IS NULL)::int AS alive_no_person_id,
  COUNT(*) FILTER (WHERE deleted_at IS NULL AND canonical_person_id IS NULL)::int AS alive_no_canonical,
  COUNT(*) FILTER (WHERE deleted_at IS NULL AND person_id IS NULL AND canonical_person_id IS NOT NULL)::int AS alive_no_personid_but_canonical,
  COUNT(*) FILTER (WHERE deleted_at IS NULL AND person_id IS NOT NULL AND canonical_person_id IS NULL)::int AS alive_personid_no_canonical,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS soft_deleted_rows
FROM public.activity_participants;
