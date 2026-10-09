DO $do$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.crm_person_role_sync_v1() FROM PUBLIC, anon, authenticated';
  EXECUTE 'COMMENT ON FUNCTION public.crm_person_role_sync_v1() IS ''AFTER trigger: keep derived business roles aligned with the owning business records''';
END $do$;
