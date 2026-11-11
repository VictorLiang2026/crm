BEGIN;
LOCK TABLE public.crm_action_context_commands IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS(SELECT 1 FROM public.crm_action_context_commands WHERE executed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Confirmed links or waiting decisions exist; export and reconcile first';
  END IF;
END $guard$;
DROP FUNCTION public.crm_action_context_v1(text,text,jsonb);
DROP FUNCTION public.crm_action_center_v1(text,jsonb);
DROP VIEW public.v_recruit_action_directory;
DROP VIEW public.v_next_context_action;
DROP VIEW public.v_action_context_links;
DROP TABLE public.crm_action_context_commands;
NOTIFY pgrst,'reload schema';
COMMIT;
