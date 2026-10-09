-- PMC-14 盘点 Q2：activity_participants person_type/status 分布（只读，无 PII）
SELECT COALESCE(person_type, '<null>') AS person_type,
       COALESCE(status, '<null>') AS status,
       COUNT(*)::int AS rows,
       COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS soft_deleted
FROM public.activity_participants
GROUP BY 1, 2
ORDER BY 3 DESC;
