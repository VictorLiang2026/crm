-- PMC-14 盘点 Q6：activity_participants 按 person_type 细分身份关联状态（只读，无 PII）
SELECT person_type,
  COUNT(*)::int AS rows,
  COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS alive,
  COUNT(*) FILTER (WHERE person_id IS NOT NULL)::int AS with_person_id,
  COUNT(*) FILTER (WHERE canonical_person_id IS NOT NULL)::int AS with_canonical,
  COUNT(*) FILTER (WHERE person_id IS NOT NULL AND canonical_person_id IS NULL)::int AS pid_no_canonical,
  COUNT(*) FILTER (WHERE person_id IS NULL AND canonical_person_id IS NOT NULL)::int AS canonical_no_pid,
  COUNT(*) FILTER (WHERE person_name IS NULL)::int AS no_name
FROM public.activity_participants
GROUP BY 1
ORDER BY 1;
