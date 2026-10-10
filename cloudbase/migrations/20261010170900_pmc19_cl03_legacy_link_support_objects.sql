-- PMC-19 CL-03 support objects (archived by PMC-20): remove trigger/constraint
-- dependencies of persons.legacy_customer_id before the column drop (180000), then
-- rewire the persons role trigger after the drop.
-- Executed 2026-10-10 from tools/pmc19-cl03-step2/3/4/6-*.sql.
-- Real execution order interleaves the column drop (20261010180000):
--   steps 2-4 below -> 20261010180000 DROP COLUMN -> 20261010180100 sync func + step 6.
-- Steps 2-4 (before the column drop):
DROP TRIGGER IF EXISTS crm_person_role_persons_sync ON public.persons;
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_legacy_customer_id_key;
ALTER TABLE public.persons DROP CONSTRAINT IF EXISTS persons_legacy_customer_id_id_unique;
-- Step 6 (after 20261010180000 column drop and 20261010180100 sync function update):
CREATE TRIGGER crm_person_role_persons_sync
  AFTER UPDATE OF deleted_at ON public.persons
  FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1();
