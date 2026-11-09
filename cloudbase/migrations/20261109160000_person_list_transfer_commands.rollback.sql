-- Rollback removes only the temporary command object, never imported Person data.
-- Run only after all active previews/executions are completed or expired and reviewed.
DO $rollback$
BEGIN
  IF to_regclass('public.crm_person_list_transfer_commands') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.crm_person_list_transfer_commands
    WHERE status IN ('ready','executing','partial') AND expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'Active Person list transfer execution exists; finish or expire it before rollback';
  END IF;
  DROP TABLE public.crm_person_list_transfer_commands;
END
$rollback$;
