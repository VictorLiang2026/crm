-- Roll back only the atomic distinct-Person writer; no Person data is changed by this rollback.
DO $rollback$
BEGIN
  IF to_regprocedure('public.crm_person_list_transfer_create_v1(text,jsonb,jsonb)') IS NULL THEN
    RETURN;
  END IF;
  DROP FUNCTION public.crm_person_list_transfer_create_v1(text,jsonb,jsonb);
END
$rollback$;
