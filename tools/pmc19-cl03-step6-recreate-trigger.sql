CREATE TRIGGER crm_person_role_persons_sync
  AFTER UPDATE OF deleted_at ON public.persons
  FOR EACH ROW EXECUTE FUNCTION public.crm_person_role_sync_v1();
