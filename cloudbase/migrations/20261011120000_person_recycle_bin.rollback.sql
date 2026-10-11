-- Rollback for 20261011120000_person_recycle_bin.sql
-- Drops the three functions, the command table and the seven batch-marker columns.
-- Soft-deleted rows stay as they are (deleted_at/delete_batch_id values are data, not schema).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DROP FUNCTION IF EXISTS public.crm_person_delete_preview_v1(text,uuid,bigint);
DROP FUNCTION IF EXISTS public.crm_person_delete_execute_v1(text,uuid);
DROP FUNCTION IF EXISTS public.crm_person_restore_v1(text,bigint);
DROP TABLE IF EXISTS public.person_delete_commands;

ALTER TABLE public.persons               DROP COLUMN IF EXISTS delete_batch_id;
ALTER TABLE public.opportunities         DROP COLUMN IF EXISTS delete_batch_id;
ALTER TABLE public.relationships         DROP COLUMN IF EXISTS delete_batch_id;
ALTER TABLE public.households            DROP COLUMN IF EXISTS delete_batch_id;
ALTER TABLE public.household_members     DROP COLUMN IF EXISTS delete_batch_id;
ALTER TABLE public.activity_participants DROP COLUMN IF EXISTS delete_batch_id;
ALTER TABLE public.activity_speakers     DROP COLUMN IF EXISTS delete_batch_id;

COMMIT;
