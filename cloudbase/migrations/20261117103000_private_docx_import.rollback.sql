BEGIN;
LOCK TABLE public.knowledge_manual_imports IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.knowledge_manual_imports) THEN RAISE EXCEPTION 'Export private manual imports before rollback'; END IF;
END $guard$;
DROP FUNCTION public.crm_manual_import_v1(text,text,jsonb);
DROP TABLE public.knowledge_manual_imports;
COMMIT;
