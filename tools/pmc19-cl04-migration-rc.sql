-- CL-04 Part 2: DROP composite FK on recruit_candidates (simple FK recruit_candidates_person_fk already exists)
ALTER TABLE public.recruit_candidates DROP CONSTRAINT IF EXISTS recruit_candidates_customer_person_fk;
