-- PC07 rollback. Existing context items remain; lifecycle command/audit rows are removed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.crm_context_item_commands WHERE status='executed') OR
     EXISTS (SELECT 1 FROM public.context_items WHERE source_type='context_items') THEN
    RAISE EXCEPTION 'PC07 rollback blocked: executed context history exists; preserve audit and derived facts';
  END IF;
END $guard$;
DROP FUNCTION IF EXISTS public.crm_context_item_execute_v1(text,uuid);
DROP FUNCTION IF EXISTS public.crm_context_item_preview_v1(text,uuid,bigint,bigint,text,jsonb);
DROP TABLE IF EXISTS public.crm_context_item_commands;
REVOKE UPDATE (confirmed, confirmed_by_uid, confirmed_at, valid_to, last_verified_at)
  ON public.context_items FROM service_role;
COMMIT;
