ALTER TABLE public.relationships
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'ai_suggested', 'legacy_note')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed')),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by_uid text
    CHECK (confirmed_by_uid IS NULL OR btrim(confirmed_by_uid) <> '');
