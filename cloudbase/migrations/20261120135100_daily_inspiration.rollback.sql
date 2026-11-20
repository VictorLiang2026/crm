BEGIN;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.daily_inspiration_history) OR EXISTS (SELECT 1 FROM public.daily_inspiration_slots)
    OR EXISTS (SELECT 1 FROM public.daily_inspiration_quotes WHERE is_seed=false OR updated_at>created_at OR enabled=false)
    OR EXISTS (SELECT 1 FROM public.daily_inspiration_settings) THEN
    RAISE EXCEPTION 'DAILY_INSPIRATION_HAS_USER_DATA: inspect history and export data before rollback';
  END IF;
END;
$guard$;
DROP FUNCTION public.crm_daily_inspiration_v1(text,text,jsonb);
DROP TABLE public.daily_inspiration_history;
DROP TABLE public.daily_inspiration_slots;
DROP TABLE public.daily_inspiration_settings;
DROP TABLE public.daily_inspiration_quotes;
COMMIT;
