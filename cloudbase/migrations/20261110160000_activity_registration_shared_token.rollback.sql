BEGIN;
SET LOCAL lock_timeout = '4s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.activity_registration_submissions
    GROUP BY management_token_hash
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Shared activity registration credentials exist; refusing to restore per-registration uniqueness';
  END IF;
END $$;

DROP INDEX public.activity_registration_submissions_management_token_hash_idx;
ALTER TABLE public.activity_registration_submissions
  ADD CONSTRAINT activity_registration_submissions_management_token_hash_key UNIQUE (management_token_hash);

COMMIT;
