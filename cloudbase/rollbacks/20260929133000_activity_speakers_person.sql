-- Refuse to remove associations made after the migration. Restore them or
-- migrate them separately before executing this rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.activity_speakers AS speaker
    LEFT JOIN public.persons AS person ON person.id = speaker.person_id
    WHERE speaker.person_id IS NOT NULL
      AND NOT (speaker.deleted_at IS NOT NULL
        AND speaker.source = '[CRM_TEST_ONLY] speaker person verification 20260929')
      AND (speaker.customer_id IS DISTINCT FROM person.legacy_customer_id
        OR person.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Rollback would erase a Person-only or relinked speaker identity';
  END IF;
END;
$check$;

DROP TRIGGER activity_speakers_person_guard_trigger ON public.activity_speakers;
DROP FUNCTION public.activity_speakers_person_guard();
DROP INDEX public.activity_speakers_person_active_idx;
ALTER TABLE public.activity_speakers DROP CONSTRAINT activity_speakers_person_fk;
ALTER TABLE public.activity_speakers DROP COLUMN person_id;
COMMIT;
