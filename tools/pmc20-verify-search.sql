-- PMC-20 verification D: all three crm_search_people_v1 templates must execute after the
-- legacy_customer_id removal. Returns totals/coverage and a sample row key set.
SELECT 'activity_no_followup' AS template,
       (r->>'total')::int AS total,
       (r#>>'{coverage,rows}')::int AS coverage,
       (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(COALESCE((SELECT jsonb_array_elements(r->'rows') LIMIT 1), '{}'::jsonb)) k) AS sample_keys
FROM (SELECT public.crm_search_people_v1('activity_no_followup', 12, 30) AS r) q
UNION ALL
SELECT 'child_education_no_insurance',
       (r->>'total')::int, (r#>>'{coverage,rows}')::int,
       (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(COALESCE((SELECT jsonb_array_elements(r->'rows') LIMIT 1), '{}'::jsonb)) k)
FROM (SELECT public.crm_search_people_v1('child_education_no_insurance', 12, 30) AS r) q
UNION ALL
SELECT 'declining_priority',
       (r->>'total')::int, (r#>>'{coverage,rows}')::int,
       (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(COALESCE((SELECT jsonb_array_elements(r->'rows') LIMIT 1), '{}'::jsonb)) k)
FROM (SELECT public.crm_search_people_v1('declining_priority', 12, 30) AS r) q;
