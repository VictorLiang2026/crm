-- Read only the explicitly marked test fixture, never scan/display real records.
SELECT 'customers' AS object_name, count(*) AS fixture_count
FROM public.customers WHERE "Id" = -2026092101 AND customer_name = '[CRM_PERMISSION_TEST]20260921-rls-a'
UNION ALL
SELECT 'policy_review_reports', count(*)
FROM public.policy_review_reports WHERE id = -2026092101 AND customer_id = -2026092101
  AND customer_name = '[CRM_PERMISSION_TEST]20260921-rls-a' AND report_type = '[CRM_PERMISSION_TEST]';
