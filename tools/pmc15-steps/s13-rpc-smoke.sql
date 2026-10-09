SELECT to_jsonb(x) AS rpc_smoke FROM (
  SELECT
    (SELECT public.crm_search_people_v1('activity_no_followup', 3, 5) ? 'total') AS activity_template_ok,
    (SELECT public.crm_search_people_v1('child_education_no_insurance', 3, 5) ? 'total') AS child_template_ok,
    (SELECT public.crm_search_people_v1('declining_priority', 3, 5)->>'total') AS declining_total,
    (SELECT public.crm_search_people_v1('declining_priority', 3, 5)->'coverage'->>'source') AS declining_source
) x;
