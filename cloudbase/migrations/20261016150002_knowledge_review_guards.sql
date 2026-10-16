BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Rows created before reviewer identity existed must be reviewed again before
-- they can influence the new AI context.
UPDATE public.knowledge_items
SET lifecycle_status='draft', verified=false, updated_at=clock_timestamp()
WHERE lifecycle_status='verified' AND verified_by IS NULL;

UPDATE public.playbooks
SET lifecycle_status='draft', updated_at=clock_timestamp()
WHERE lifecycle_status='verified' AND verified_by IS NULL;

ALTER TABLE public.knowledge_items
  ADD CONSTRAINT knowledge_items_reviewed_content_check CHECK (
    lifecycle_status <> 'verified' OR
    (verified_by IS NOT NULL AND nullif(btrim(source),'') IS NOT NULL AND
      nullif(btrim(content),'') IS NOT NULL AND
      (item_type <> 'evidence' OR (confidence IS NOT NULL AND confidence >= 0.700)))
  );

ALTER TABLE public.playbooks
  ADD CONSTRAINT playbooks_reviewed_content_check CHECK (
    lifecycle_status <> 'verified' OR
    (verified_by IS NOT NULL AND nullif(btrim(source),'') IS NOT NULL AND
      nullif(btrim(scenario),'') IS NOT NULL AND nullif(btrim(objection),'') IS NOT NULL AND
      nullif(btrim(response_logic),'') IS NOT NULL AND confidence IS NOT NULL AND confidence >= 0.700)
  );

COMMIT;
