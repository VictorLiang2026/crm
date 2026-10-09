DO $do$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS crm_person_role_customers_sync ON public.customers';
  EXECUTE 'CREATE TRIGGER crm_person_role_customers_sync AFTER INSERT OR UPDATE OF person_id, deleted_at OR DELETE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1()';
  EXECUTE 'DROP TRIGGER IF EXISTS crm_person_role_recruits_sync ON public.recruit_candidates';
  EXECUTE 'CREATE TRIGGER crm_person_role_recruits_sync AFTER INSERT OR UPDATE OF person_id, deleted_at OR DELETE ON public.recruit_candidates FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1()';
  EXECUTE 'DROP TRIGGER IF EXISTS crm_person_role_speakers_sync ON public.activity_speakers';
  EXECUTE 'CREATE TRIGGER crm_person_role_speakers_sync AFTER INSERT OR UPDATE OF person_id, deleted_at OR DELETE ON public.activity_speakers FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1()';
  EXECUTE 'DROP TRIGGER IF EXISTS crm_person_role_participants_sync ON public.activity_participants';
  EXECUTE 'CREATE TRIGGER crm_person_role_participants_sync AFTER INSERT OR UPDATE OF canonical_person_id, deleted_at OR DELETE ON public.activity_participants FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1()';
  EXECUTE 'DROP TRIGGER IF EXISTS crm_person_role_persons_sync ON public.persons';
  EXECUTE 'CREATE TRIGGER crm_person_role_persons_sync AFTER UPDATE OF legacy_customer_id, deleted_at ON public.persons FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1()';
END $do$;
