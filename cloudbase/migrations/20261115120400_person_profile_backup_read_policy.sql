-- Keep the one-time recovery copy readable only through the service role.
CREATE POLICY person_profile_field_rename_backup_service_read
  ON public.person_profile_field_rename_backup_20261115
  FOR SELECT TO service_role USING (true);
GRANT SELECT ON public.person_profile_field_rename_backup_20261115 TO service_role;
