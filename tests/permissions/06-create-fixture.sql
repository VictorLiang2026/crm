-- Test data only. No permissions/DDL changes. Run once after 05 guard passes.
-- Negative explicit IDs avoid touching identity sequences. Soft-deleted fixture
-- does not appear in active business lists; it can appear in the recycle bin
-- until 07 cleanup is executed. Never use these IDs for non-test records.
DO $probe$
BEGIN
  IF EXISTS (SELECT 1 FROM public.customers WHERE "Id" = -2026092101 OR customer_name = '[CRM_PERMISSION_TEST]20260921-rls-a')
     OR EXISTS (SELECT 1 FROM public.policy_review_reports WHERE id = -2026092101) THEN
    RAISE EXCEPTION 'Fixture identifier occupied: stop without changing any row';
  END IF;
  INSERT INTO public.customers ("Id", customer_name, source, additional_info, deleted_at)
    OVERRIDING SYSTEM VALUE
    VALUES (-2026092101, '[CRM_PERMISSION_TEST]20260921-rls-a', '[CRM_PERMISSION_TEST]',
            'Temporary isolated permission validation record; no real customer data', CURRENT_TIMESTAMP);
  INSERT INTO public.policy_review_reports (id, customer_id, customer_name, report_type, summary, deleted_at)
    VALUES (-2026092101, -2026092101, '[CRM_PERMISSION_TEST]20260921-rls-a',
            '[CRM_PERMISSION_TEST]', '[CRM_PERMISSION_TEST]synthetic report', CURRENT_TIMESTAMP);
END
$probe$;
