-- PMC-14 盘点 Q5：activity_tasks.related_id 语义按 related_type 分流验证（只读，无 PII）
SELECT COALESCE(t.related_type, '<null>') AS related_type,
       COUNT(*)::int AS rows,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.customers c WHERE c."Id" = t.related_id))::int AS hits_customers,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.persons p WHERE p.id = t.related_id))::int AS hits_persons,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.recruit_candidates rc WHERE rc.id = t.related_id))::int AS hits_candidates,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.activity_participants ap WHERE ap.id = t.related_id))::int AS hits_participants
FROM public.activity_tasks t
GROUP BY 1
ORDER BY 2 DESC;
