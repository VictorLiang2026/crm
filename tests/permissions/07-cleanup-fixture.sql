-- Remove ONLY the exact marked fixtures created by 06. Never cascade.
-- Refuse cleanup if identifiers have been repurposed or markers changed.
DO $probe$
BEGIN
  IF EXISTS (SELECT 1 FROM public.customers WHERE "Id" = -2026092101 AND customer_name <> '[CRM_PERMISSION_TEST]20260921-rls-a')
     OR EXISTS (SELECT 1 FROM public.policy_review_reports WHERE id = -2026092101
       AND (customer_id <> -2026092101 OR customer_name IS DISTINCT FROM '[CRM_PERMISSION_TEST]20260921-rls-a' OR report_type <> '[CRM_PERMISSION_TEST]')) THEN
    RAISE EXCEPTION 'Fixture marker mismatch: stop without deleting any row';
  END IF;
  DELETE FROM public.policy_review_reports WHERE id = -2026092101 AND customer_id = -2026092101
    AND customer_name = '[CRM_PERMISSION_TEST]20260921-rls-a' AND report_type = '[CRM_PERMISSION_TEST]';
  DELETE FROM public.customers WHERE "Id" = -2026092101 AND customer_name = '[CRM_PERMISSION_TEST]20260921-rls-a'
    AND source = '[CRM_PERMISSION_TEST]';
END
$probe$;
