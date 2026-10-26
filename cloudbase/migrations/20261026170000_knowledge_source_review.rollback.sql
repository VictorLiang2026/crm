BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.knowledge_sources,public.knowledge_items IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.knowledge_sources WHERE lifecycle_status='verified')
     OR EXISTS (SELECT 1 FROM public.knowledge_items WHERE source_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Reviewed knowledge source data exists; rollback would disable its governance boundary';
  END IF;
END $guard$;
REVOKE ALL ON FUNCTION public.crm_knowledge_source_review_v1(text,bigint,bigint,text,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public.crm_knowledge_source_review_v1(text,bigint,bigint,text,timestamptz);
COMMIT;
