-- PMC-20 recovery drill (read-only): simulate the CL-03 rollback backfill coverage for
-- persons.legacy_customer_id when restored from customers (all rows, including soft-
-- deleted ones, matching the pre-drop state where 783 persons carried the link).
SELECT
  (SELECT count(*) FROM public.persons) AS persons_total,
  (SELECT count(*) FROM public.customers) AS customers_total,
  (SELECT count(DISTINCT person_id) FROM public.customers WHERE person_id IS NOT NULL) AS distinct_person_links,
  (SELECT count(*) FROM public.customers WHERE person_id IS NULL) AS customers_without_link,
  (SELECT count(*) FROM public.customers WHERE deleted_at IS NOT NULL) AS soft_deleted_customers,
  (SELECT count(*) FROM public.persons p
     WHERE NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.person_id = p.id)) AS persons_without_any_customer;
