-- PMC-16 q5: interactions 来源分布与双轨现状
SELECT coalesce(source_type,'<null>') AS source_type,
       count(*) AS total,
       count(*) FILTER (WHERE source_id IS NULL) AS null_source_id,
       min(interaction_at) AS earliest, max(interaction_at) AS latest
FROM public.interactions
GROUP BY 1
ORDER BY total DESC;
