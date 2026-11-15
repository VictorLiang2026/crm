-- Restore the existing invoker-security boundary and least-privilege ACLs on
-- views rebuilt by the Person profile field migration.
ALTER VIEW public.v_activity_roster_people SET (security_invoker = true);
ALTER VIEW public.v_recruit_candidates SET (security_invoker = true);
ALTER VIEW public.v_recruit_candidates_person_only SET (security_invoker = true);
ALTER VIEW public.v_recruit_action_directory SET (security_invoker = true);

REVOKE ALL ON public.v_activity_roster_people,
  public.v_recruit_candidates,
  public.v_recruit_candidates_person_only,
  public.v_recruit_action_directory
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.v_activity_roster_people TO service_role;
GRANT SELECT ON public.v_recruit_candidates TO anon;
GRANT ALL ON public.v_recruit_candidates TO service_role;
GRANT ALL ON public.v_recruit_candidates_person_only TO service_role;
GRANT SELECT ON public.v_recruit_action_directory TO service_role;
