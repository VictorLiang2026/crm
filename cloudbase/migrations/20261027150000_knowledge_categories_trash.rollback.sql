BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE public.knowledge_items, public.playbooks, public.knowledge_sources IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.knowledge_items WHERE deleted_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.playbooks WHERE deleted_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.knowledge_sources WHERE deleted_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.knowledge_sources WHERE domain='other') THEN
    RAISE EXCEPTION 'Restore trashed rows and replace source domain other before rollback';
  END IF;
END
$guard$;

REVOKE ALL ON FUNCTION public.crm_knowledge_set_valid_v1(text,bigint,boolean,text,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.crm_knowledge_set_valid_v1(text,bigint,boolean,text,timestamptz);
DROP INDEX public.knowledge_items_trash_idx;
DROP INDEX public.playbooks_trash_idx;
DROP INDEX public.knowledge_sources_trash_idx;
ALTER TABLE public.knowledge_sources DROP CONSTRAINT knowledge_sources_domain_check;
ALTER TABLE public.knowledge_sources ADD CONSTRAINT knowledge_sources_domain_check
  CHECK (domain IN ('product','company','service','recruitment','industry','campaign',
    'health_wealth_seminar','top_performer_sharing','legal_tax','case','playbook'));
ALTER TABLE public.knowledge_items DROP COLUMN deleted_at;
ALTER TABLE public.playbooks DROP COLUMN deleted_at;
ALTER TABLE public.knowledge_sources DROP COLUMN deleted_at;

COMMIT;
