-- Refuse rollback after a business operation; business rows are never automatically reverted.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $g$ BEGIN
 IF EXISTS(SELECT 1 FROM public.crm_legacy_opportunity_maintenance_commands WHERE status='executed') THEN
   RAISE EXCEPTION 'Executed maintenance exists; preserve audit and assess data before rollback'; END IF;
END $g$;
DROP FUNCTION public.crm_legacy_opportunity_maintenance_v1(text,text,jsonb);
DROP TABLE public.crm_legacy_opportunity_maintenance_commands;
NOTIFY pgrst,'reload schema';
COMMIT;
