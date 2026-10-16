BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Lossless rollback: disable the service-only review operation but retain the
-- additive governance columns, constraints and indexes. Those columns contain
-- reviewer identity, lifecycle, validity and revision history. Dropping them
-- would erase approved business audit data. The legacy verified boolean stays
-- synchronized by the forward RPC; existing records and all row content remain.
REVOKE ALL ON FUNCTION public.crm_knowledge_review_v1(text,bigint,text,text,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.crm_knowledge_review_v1(text,bigint,text,text,timestamptz);

COMMENT ON TABLE public.knowledge_items IS
  'PC22 governance columns retained on rollback to preserve reviewer and revision history.';
COMMENT ON TABLE public.playbooks IS
  'PC22 governance columns retained on rollback to preserve reviewer and revision history.';
COMMIT;
