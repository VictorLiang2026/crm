SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='persons' AND column_name='legacy_customer_id') AS col_exists,
  (SELECT count(*) FROM public.persons) AS persons_total,
  (SELECT count(*) FROM public.customers) AS customers_total,
  (SELECT count(*) FROM pg_trigger WHERE tgname='crm_person_role_persons_sync') AS trigger_exists;
