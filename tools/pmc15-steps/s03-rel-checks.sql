DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.relationships'::regclass
                   AND conname='relationships_type_vocab_check') THEN
    ALTER TABLE public.relationships
      ADD CONSTRAINT relationships_type_vocab_check
      CHECK (relationship_type IN
        ('family', 'friend', 'colleague', 'business', 'referral', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='public.relationships'::regclass
                   AND conname='relationships_confirmation_check') THEN
    ALTER TABLE public.relationships
      ADD CONSTRAINT relationships_confirmation_check CHECK (
        (status = 'pending'  AND confirmed_at IS NULL AND confirmed_by_uid IS NULL)
        OR
        (status = 'confirmed' AND confirmed_at IS NOT NULL
         AND btrim(confirmed_by_uid) IS NOT NULL AND btrim(confirmed_by_uid) <> '')
      );
  END IF;
END $do$;
