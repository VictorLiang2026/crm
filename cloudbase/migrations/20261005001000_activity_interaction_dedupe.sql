-- WP12: an exact confirmed activity event must survive concurrent replay once.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF to_regclass('public.wp12_activity_interaction_once_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'WP12 activity interaction index already exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.interactions
    WHERE source_type = 'manual' AND activity_id IS NOT NULL
      AND interaction_type IN ('invitation','conversation','speaker_cooperation','post_event_followup')
    GROUP BY person_id, activity_id, interaction_type, interaction_at, md5(summary)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existing duplicate activity interactions require review';
  END IF;
END $guard$;

CREATE UNIQUE INDEX wp12_activity_interaction_once_idx
  ON public.interactions(person_id, activity_id, interaction_type, interaction_at, md5(summary))
  WHERE source_type = 'manual' AND activity_id IS NOT NULL
    AND interaction_type IN ('invitation','conversation','speaker_cooperation','post_event_followup');
COMMIT;
