-- PMC-19 CL-04 part 1 (archived by PMC-20): drop the composite FK on opportunities
-- that referenced persons(legacy_customer_id, id). The simple FK to customers remains.
-- Executed 2026-10-10 from tools/pmc19-cl04-migration-opp.sql.
ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_customer_person_fk;
