BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN IF EXISTS (SELECT FROM public.activity_roster_people) OR EXISTS(SELECT FROM public.activity_roster_commands WHERE completed_at IS NOT NULL) THEN RAISE EXCEPTION 'Export new roster data before rollback'; END IF; END $$;
DROP FUNCTION public.crm_activity_roster_v1(text,text,jsonb);
DROP VIEW public.v_activity_roster_people;
DROP POLICY roster_private_rows ON public.activity_participants;
ALTER TABLE public.activity_participants DROP COLUMN roster_id;
DROP TABLE public.activity_roster_commands,public.activity_roster_people;
COMMIT;
