-- Revert callers before applying. This removes only unexecuted/executed command
-- receipts; inspect them first and retain evidence. Business rows are untouched.
BEGIN;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.crm_work_item_commands WHERE status='executed') THEN
    RAISE EXCEPTION 'Executed WP08 receipts exist; preserve them and assess business rows before rollback';
  END IF;
END $guard$;
DROP FUNCTION public.crm_work_item_execute_v1(text,uuid);
DROP FUNCTION public.crm_work_item_preview_v1(text,uuid,text,text,bigint,bigint,jsonb);
DROP TABLE public.crm_work_item_commands;
COMMIT;
