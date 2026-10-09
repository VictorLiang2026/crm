DO $do$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.crm_person_roles_derive_v1(bigint) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.crm_person_roles_derive_v1(bigint) TO service_role';
  EXECUTE 'COMMENT ON FUNCTION public.crm_person_roles_derive_v1(bigint) IS ''Recompute the four derived business roles for one Person from active business records; human-only role tags are untouched''';
END $do$;
