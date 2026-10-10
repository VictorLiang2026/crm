-- CL-04 Part 2 Rollback: re-add composite FK on recruit_candidates
ALTER TABLE public.recruit_candidates ADD CONSTRAINT recruit_candidates_customer_person_fk
  FOREIGN KEY (customer_id, person_id) REFERENCES persons(legacy_customer_id, id) ON DELETE RESTRICT;
