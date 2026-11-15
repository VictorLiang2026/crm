-- Restore the immediately preceding state if this focused security repair is
-- rolled back. The Person schema migration rollback follows separately.
ALTER VIEW public.v_activity_roster_people RESET (security_invoker);
ALTER VIEW public.v_recruit_candidates RESET (security_invoker);
ALTER VIEW public.v_recruit_candidates_person_only RESET (security_invoker);
ALTER VIEW public.v_recruit_action_directory RESET (security_invoker);

REVOKE ALL ON public.v_activity_roster_people,
  public.v_recruit_candidates,
  public.v_recruit_candidates_person_only,
  public.v_recruit_action_directory
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_activity_roster_people,
  public.v_recruit_candidates,
  public.v_recruit_candidates_person_only,
  public.v_recruit_action_directory TO anon;
GRANT ALL ON public.v_activity_roster_people,
  public.v_recruit_candidates,
  public.v_recruit_candidates_person_only,
  public.v_recruit_action_directory TO service_role;
GRANT ALL ON public.v_activity_roster_people,
  public.v_recruit_candidates,
  public.v_recruit_candidates_person_only,
  public.v_recruit_action_directory TO authenticated;
