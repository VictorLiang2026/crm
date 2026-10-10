-- PMC-19 CL-04 part 2 (archived by PMC-20): drop the composite FK on recruit_candidates
-- that referenced persons(legacy_customer_id, id). The simple FKs remain.
-- Executed 2026-10-10 from tools/pmc19-cl04-migration-rc.sql.
ALTER TABLE public.recruit_candidates DROP CONSTRAINT IF EXISTS recruit_candidates_customer_person_fk;
