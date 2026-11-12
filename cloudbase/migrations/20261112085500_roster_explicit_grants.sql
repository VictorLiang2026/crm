BEGIN;
REVOKE ALL ON SEQUENCE public.activity_roster_people_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE,SELECT ON SEQUENCE public.activity_roster_people_id_seq TO service_role;
REVOKE ALL ON public.activity_roster_people,public.activity_roster_commands,public.v_activity_roster_people FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.activity_roster_people,public.activity_roster_commands TO service_role;
GRANT SELECT ON public.v_activity_roster_people TO service_role;
COMMIT;
