SELECT
  'crm_customers_page_v1' AS rpc,
  (crm_customers_page_v1(1, 5, '', 'Id', 'desc', NULL, NULL)->>'total')::text AS total_or_type,
  jsonb_array_length(crm_customers_page_v1(1, 5, '', 'Id', 'desc', NULL, NULL)->'items') AS rows_returned
UNION ALL
SELECT
  'person_directory_page_v1',
  (person_directory_page_v1(1, 5, '', 'id', 'desc')->>'total')::text,
  jsonb_array_length(person_directory_page_v1(1, 5, '', 'id', 'desc')->'items')
UNION ALL
SELECT
  'pmc18_collect_metrics',
  jsonb_typeof(pmc18_collect_metrics()),
  NULL
UNION ALL
SELECT 'search/activity_no_followup',
  coalesce(crm_search_people_v1('activity_no_followup', 12, 10)->>'total',
           crm_search_people_v1('activity_no_followup', 12, 10)->>'coverage'), NULL
UNION ALL
SELECT 'search/child_education_no_insurance',
  coalesce(crm_search_people_v1('child_education_no_insurance', 12, 10)->>'total',
           crm_search_people_v1('child_education_no_insurance', 12, 10)->>'coverage'), NULL
UNION ALL
SELECT 'search/declining_priority',
  coalesce(crm_search_people_v1('declining_priority', 12, 10)->>'total',
           crm_search_people_v1('declining_priority', 12, 10)->>'coverage'), NULL;
