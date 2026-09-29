-- Removes only the canonical link introduced by the paired migration.
-- Existing legacy participant identity and soft-delete state are untouched.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP TRIGGER IF EXISTS activity_participants_canonical_guard_trigger
  ON public.activity_participants;
DROP FUNCTION IF EXISTS public.activity_participants_canonical_guard();
DROP INDEX IF EXISTS public.activity_participants_canonical_active_uq;
ALTER TABLE public.activity_participants
  DROP CONSTRAINT IF EXISTS activity_participants_canonical_person_fk;
ALTER TABLE public.activity_participants
  DROP COLUMN IF EXISTS canonical_person_id;
COMMIT;
