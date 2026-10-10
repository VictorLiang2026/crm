SELECT person_id, count(*) AS cnt FROM public.customers
WHERE deleted_at IS NULL
GROUP BY person_id HAVING count(*) > 1;
