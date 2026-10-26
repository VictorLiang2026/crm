BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE public.knowledge_sources, public.knowledge_items, public.ai_tasks, public.ai_results
  IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.knowledge_sources)
     OR EXISTS (SELECT 1 FROM public.knowledge_items WHERE source_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.ai_tasks WHERE skill_name='dual_followup') THEN
    RAISE EXCEPTION 'Knowledge library data or dual AI audit exists; rollback would discard history';
  END IF;
END $guard$;

REVOKE ALL ON FUNCTION public.crm_ai_finish_dual_v1(bigint,bigint,boolean,text,jsonb,jsonb,boolean)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.crm_ai_select_dual_v1(bigint,bigint,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public.crm_ai_finish_dual_v1(bigint,bigint,boolean,text,jsonb,jsonb,boolean);
DROP FUNCTION public.crm_ai_select_dual_v1(bigint,bigint,text,jsonb);
ALTER TABLE public.knowledge_items DROP CONSTRAINT knowledge_items_source_fk;
DROP INDEX public.knowledge_items_source_idx;
ALTER TABLE public.knowledge_items DROP COLUMN source_id;
DROP TABLE public.knowledge_sources;

COMMIT;
