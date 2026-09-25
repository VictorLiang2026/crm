-- Roll back only when all three new tables are empty; never erase runtime history silently.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.ai_results, public.ai_runs, public.ai_tasks IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_results LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.ai_runs LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.ai_tasks LIMIT 1) THEN
    RAISE EXCEPTION 'AI Runtime rollback refused: tables contain data';
  END IF;
END $guard$;
DROP TABLE public.ai_results RESTRICT;
DROP TABLE public.ai_runs RESTRICT;
DROP TABLE public.ai_tasks RESTRICT;
COMMIT;
