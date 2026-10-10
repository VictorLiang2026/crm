-- ROLLBACK for 20261010170610. Re-adds the composite FK. Prerequisite chain identical to
-- 20261010170600 rollback (restore legacy_customer_id + composite unique first).
ALTER TABLE public.recruit_candidates ADD CONSTRAINT recruit_candidates_customer_person_fk
  FOREIGN KEY (customer_id, person_id) REFERENCES persons(legacy_customer_id, id) ON DELETE RESTRICT;
