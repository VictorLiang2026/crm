-- Restore the prior WP07.1 identity-command behavior without changing data.
DROP TRIGGER IF EXISTS crm_test_identity_command_guard
  ON public.person_identity_commands;
DROP FUNCTION IF EXISTS public.crm_test_identity_command_guard_v1();
