-- Safe application rollback: restore previous app release first, then disable ONLY this bridge.
-- Retain additive columns, backfilled records, references and the appended view column.
-- No historical data, existing table/view/function/route is deleted or renamed.
BEGIN;
ALTER TABLE public.followups DISABLE TRIGGER crm_followup_interaction_sync;
ALTER TABLE public.followups DISABLE TRIGGER crm_followup_interaction_delete;
ALTER TABLE public.interactions DISABLE TRIGGER crm_interaction_followup_sync;
NOTIFY pgrst,'reload schema';
COMMIT;
