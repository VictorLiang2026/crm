BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Rollback removes only the additional reviewed-content constraints. Any rows
-- moved back to draft stay in draft, preserving the safe review boundary.
ALTER TABLE public.knowledge_items DROP CONSTRAINT knowledge_items_reviewed_content_check;
ALTER TABLE public.playbooks DROP CONSTRAINT playbooks_reviewed_content_check;
COMMIT;
