-- WP07.1: test accounts may preview and execute identity commands only for
-- fictional, marked Persons. This applies to existing Persons as well as new ones.
CREATE OR REPLACE FUNCTION public.crm_test_identity_command_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.crm_test_batches AS b
    WHERE b.created_by_uid = NEW.actor_uid
  ) THEN
    IF position('【系统测试·勿联系】' IN coalesce(NEW.payload->>'display_name', '')) = 0 THEN
      RAISE EXCEPTION 'Test account must use fictional marked Person';
    END IF;
    IF nullif(NEW.payload->>'person_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.crm_test_records AS r
      JOIN public.crm_test_batches AS b ON b.batch_key = r.batch_key
      WHERE b.created_by_uid = NEW.actor_uid
        AND r.record_table = 'persons'
        AND r.record_id = NEW.payload->>'person_id'
    ) THEN
      RAISE EXCEPTION 'Test account must use a tracked fictional Person';
    END IF;
  END IF;
  RETURN NEW;
END $guard$;

REVOKE ALL ON FUNCTION public.crm_test_identity_command_guard_v1()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER crm_test_identity_command_guard
BEFORE INSERT OR UPDATE OF status ON public.person_identity_commands
FOR EACH ROW EXECUTE FUNCTION public.crm_test_identity_command_guard_v1();
