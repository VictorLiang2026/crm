-- PMC-19 CL-09 (archived by PMC-20): retire the trigger that auto-created/linked a
-- Person from a recruit_candidates customer_id. Recruit create now carries person_id
-- via the explicit customer link through service code. Executed 2026-10-10 from
-- tools/pmc19-cl09-migration-trigger.sql and tools/pmc19-cl09-migration-function.sql.
DROP TRIGGER IF EXISTS recruit_candidate_person_sync_trigger ON public.recruit_candidates;
DROP FUNCTION IF EXISTS public.recruit_candidate_person_sync();
