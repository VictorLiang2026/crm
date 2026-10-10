-- CL-04 Part 1 Rollback: re-add composite FK on opportunities
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_customer_person_fk
  FOREIGN KEY (customer_id, person_id) REFERENCES persons(legacy_customer_id, id) ON DELETE RESTRICT;
