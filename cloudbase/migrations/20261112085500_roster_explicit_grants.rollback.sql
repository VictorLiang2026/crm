BEGIN;
-- Restore the preceding server-side access. Client roles remain denied on this identity sequence.
GRANT ALL ON public.activity_roster_people,public.activity_roster_commands,public.v_activity_roster_people TO service_role;
GRANT ALL ON SEQUENCE public.activity_roster_people_id_seq TO service_role;
COMMIT;
