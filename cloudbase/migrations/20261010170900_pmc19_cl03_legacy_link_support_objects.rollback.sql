-- ROLLBACK for 20261010170900. Reverses the trigger/constraint changes around the
-- legacy_customer_id column. MUST be applied together with (after) the
-- 20261010180000 CL-03 rollback which restores and backfills the column, and together
-- with the 20261010180100 rollback which restores the old crm_person_role_sync_v1 body.
-- Full reversal order:
--   20261010180000 rollback (column + persons_legacy_customer_id_key)
--   -> this file (composite unique + old trigger)
--   -> 20261010180100 rollback (old sync function body)
--   -> 20261010170600/170610 rollbacks (composite FKs) as needed.
DROP TRIGGER IF EXISTS crm_person_role_persons_sync ON public.persons;
ALTER TABLE public.persons
  ADD CONSTRAINT persons_legacy_customer_id_id_unique UNIQUE (legacy_customer_id, id);
-- persons_legacy_customer_id_key (single-column unique) is restored by the
-- 20261010180000 rollback.
CREATE TRIGGER crm_person_role_persons_sync
  AFTER UPDATE OF legacy_customer_id, deleted_at ON public.persons
  FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1();
