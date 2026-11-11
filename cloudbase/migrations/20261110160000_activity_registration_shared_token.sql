BEGIN;
SET LOCAL lock_timeout = '4s';

ALTER TABLE public.activity_registration_submissions
  DROP CONSTRAINT activity_registration_submissions_management_token_hash_key;
CREATE INDEX activity_registration_submissions_management_token_hash_idx
  ON public.activity_registration_submissions(management_token_hash, created_at DESC, id);

COMMIT;
