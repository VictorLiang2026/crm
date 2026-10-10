-- CL-04 Part 1: DROP composite FK on opportunities (simple FK opportunities_person_fk already exists)
ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_customer_person_fk;
